/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 The deferred Quit: stop the child servers, then answer AppKit on a route AppKit
 actually services.

 ## The bug this type exists for

 `applicationShouldTerminate` returning `.terminateLater` puts
 `-[NSApplication _shouldTerminate]` into a NESTED event loop while it waits for
 `reply(toApplicationShouldTerminate:)`. That loop services the run loop's own
 blocks (`CFRunLoopPerformBlock`) but **not the main dispatch queue** — and
 Swift's main-actor executor IS the main dispatch queue. So the obvious shape,
 `await MainActor.run { sender.reply(...) }` from a detached shutdown task, never
 runs: the app keeps a live window it will not close, every later Quit is refused
 (`request` sets `pending` and never gets to clear it), Force Quit's polite
 request is refused, and only `kill -9` ends the process. Reported as "after
 updating the macOS DMG the app does not quit, it has to be killed from Activity
 Monitor".

 Measured on macOS 27 with an instrumented build of this shell, quitting a real
 `NSApplication`: the detached task and its whole task group completed on pool
 threads inside the same millisecond, and the `MainActor.run` that owed the reply
 was still unsent minutes later (a `sample` showed the main thread parked in
 `_shouldTerminate → nextEventMatchingMask → mach_msg`, with no concurrency thread
 holding any Kabmo frame). The identical build quit in **6 ms** once the reply was
 handed to `CFRunLoopPerformBlock` instead, with `applicationWillTerminate` logged
 on the main thread.

 ## Why the shutdown work is a `Supervisor`, not a closure

 The first version took `@escaping () async -> Void`. That hangs for the SAME
 reason the reply did, one step earlier: `NSApplicationDelegate` is a
 `@MainActor` protocol, so the app delegate (and every closure created in its
 methods) is main-actor-isolated, and awaiting such a closure from the detached
 shutdown task hops back to the main actor — which is the thread inside the nested
 loop. Measured in the window suite: the child task logged "enter", the empty
 closure never returned, and the group waited out its full ceiling. An actor
 method does not have that problem, which is why this takes the `Supervisor`
 itself (`stopAll` on an empty one returns immediately, so the suite can drive
 the real path).

 ## Why the ObjC runtime

 `replyToApplicationShouldTerminate:` is `@MainActor` in the SDK and a run-loop
 block is not, so the Swift spelling cannot be reached from there. `perform(_:
 with:)` cannot carry the argument either: it passes an OBJECT where the method
 reads a `BOOL` byte, so the reply arrives as `false` — measured, and it canceled
 the very quit it was meant to complete.
 */
import AppKit
import ObjectiveC

public final class TerminateCoordinator {
  /// The servers this shell started, plus the pids it adopted after a restart.
  private let supervisor: Supervisor
  /// The outer bound on a genuinely wedged child, in seconds.
  private let ceiling: TimeInterval
  /// A quit is already in flight. Set on the first request and only cleared by
  /// the process ending — `request` says what a second one does.
  private var pending = false

  public init(supervisor: Supervisor, ceiling: TimeInterval = 6) {
    self.supervisor = supervisor
    self.ceiling = ceiling
  }

  /// Whether a quit request is in flight.
  public var isPending: Bool { pending }

  /**
   Ask to quit, and answer AppKit.

   `reply` is the value handed back to AppKit. Production always passes `true`
   (this type exists to say yes); the window suite passes `false` so it can assert
   the reply ARRIVED without ending itself, which is the half that broke.

   **A second Quit means "now".** `.terminateCancel` — the previous answer — did
   more than ignore the press: it CANCELED the pending terminate, so the reply
   the first call owed was discarded and `pending` could never be cleared. One
   impatient second press therefore left an app no Quit could close, which is the
   reported symptom made permanent. The work the first press asked for has
   already run by the time a user presses again (milliseconds), and a child still
   holding on is what the ceiling below and the next launch's orphan adoption are
   for.
   */
  public func request(_ sender: NSApplication, reply terminate: Bool = true) -> NSApplication.TerminateReply {
    if pending { return .terminateNow }
    pending = true
    let supervisor = self.supervisor
    let ceiling = self.ceiling
    // Detached, so the work cannot be scheduled onto the main actor it is meant
    // to keep free.
    Task.detached {
      await withTaskGroup(of: Bool.self) { group -> Void in
        group.addTask {
          await supervisor.stopAll()
          return true
        }
        group.addTask {
          try? await Task.sleep(nanoseconds: UInt64(ceiling * 1_000_000_000))
          return false
        }
        // Whichever lands first ends the wait; a child that ignores SIGTERM is
        // already SIGKILLed inside `killGroup`, so the ceiling is the outer bound
        // on a genuinely wedged server.
        _ = await group.next()
        group.cancelAll()
      }
      Self.reply(sender, terminate: terminate)
    }
    return .terminateLater
  }

  /**
   Hand AppKit its answer — on the main RUN LOOP, never the main dispatch queue.

   The block is serviced by the nested loop that `_shouldTerminate` is running,
   which is the whole point (see the type's documentation); `CFRunLoopWakeUp` is
   what makes the loop notice it from the pool thread this is called on.
   */
  public static func reply(_ sender: NSApplication, terminate: Bool) {
    CFRunLoopPerformBlock(CFRunLoopGetMain(), CFRunLoopMode.commonModes.rawValue) {
      let selector = NSSelectorFromString("replyToApplicationShouldTerminate:")
      typealias Reply = @convention(c) (AnyObject, Selector, ObjCBool) -> Void
      guard let implementation = class_getMethodImplementation(NSApplication.self, selector) else { return }
      unsafeBitCast(implementation, to: Reply.self)(sender, selector, ObjCBool(terminate))
    }
    CFRunLoopWakeUp(CFRunLoopGetMain())
  }
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 An SVG path's `d` attribute, as a `CGPath`.

 The launch splash draws the SAME wordmark `README.md` embeds, and the artwork
 exists twice: once as `public/kabmo-wordmark.svg`, once as the path data in
 `Wordmark`. There is no SVG renderer in AppKit, so the path has to be replayed —
 and a parser that quietly mis-reads one command draws a wrong mark rather than
 failing.

 The subset implemented is exactly what the file uses: `M`, `L`, `H`, `V`, `Q`,
 `C`, `Z`, with implicit repeats (a coordinate pair after an `M` is a line to, per
 the SVG spec) and comma-or-space separated numbers. Anything else throws, which is
 what makes a future edit to the SVG a test failure instead of a mangled logo.
 */

import CoreGraphics
import Foundation

public enum SVGPath {

  /// One command with its absolute arguments.
  public struct Command: Equatable {
    public let op: Character
    public let args: [Double]

    public init(op: Character, args: [Double]) {
      self.op = op
      self.args = args
    }
  }

  /// Parse `d` into commands, with SVG's implicit repeats made explicit.
  ///
  /// `M48.83 -50 102.54 -91.5` is a moveto followed by an implicit lineto — the
  /// same path spelled `M 48.83,-50 L 102.54,-91.5`. Expanding it here is what
  /// lets a caller apply a single transform to a flat command list.
  public static func commands(_ d: String) throws -> [Command] {
    var out: [Command] = []
    var pending: Character?
    var numbers: [Double] = []

    for token in tokens(d) {
      if let op = token.op {
        pending = op
        continue
      }
      guard let value = token.number else { continue }
      numbers.append(value)

      guard let op = pending else { throw ParseError.leadingNumber(d) }
      let arity = self.arity(op)
      if arity == 0 {
        out.append(Command(op: op, args: []))
        continue
      }
      while numbers.count >= arity {
        let args = Array(numbers.prefix(arity))
        numbers.removeFirst(arity)
        out.append(Command(op: op, args: args))
        // A moveto's following pairs are linetos; every other command repeats
        // itself with the same op.
        pending = op == "M" ? "L" : op
      }
    }

    if !numbers.isEmpty { throw ParseError.trailingNumbers(d, numbers.count) }
    return out
  }

  /// The commands as a path, with every coordinate passed through `transform`.
  ///
  /// The transform is how the caller applies the y shift a `CGPath` needs and the
  /// SVG does not (see `Wordmark.shift`), and it is applied here rather than to
  /// the finished path so a quadratic curve's CONTROL point moves with it.
  public static func path(_ d: String, transform: (CGPoint) -> CGPoint = { $0 }) throws -> CGPath {
    let path = CGMutablePath()
    var current = CGPoint.zero
    var start = CGPoint.zero

    for command in try commands(d) {
      switch command.op {
      case "M":
        current = transform(point(command.args, 0))
        start = current
        path.move(to: current)
      case "L":
        current = transform(point(command.args, 0))
        path.addLine(to: current)
      case "V":
        current = transform(CGPoint(x: current.x, y: command.args[0]))
        path.addLine(to: current)
      case "H":
        current = transform(CGPoint(x: command.args[0], y: current.y))
        path.addLine(to: current)
      case "Q":
        let control = transform(point(command.args, 0))
        current = transform(point(command.args, 2))
        path.addQuadCurve(to: current, control: control)
      case "C":
        let first = transform(point(command.args, 0))
        let second = transform(point(command.args, 2))
        current = transform(point(command.args, 4))
        path.addCurve(to: current, control1: first, control2: second)
      case "Z":
        path.closeSubpath()
        current = start
      default:
        throw ParseError.unsupported(command.op)
      }
    }

    return path
  }

  // MARK: - Errors

  public enum ParseError: Error, CustomStringConvertible {
    case leadingNumber(String)
    case trailingNumbers(String, Int)
    case unsupported(Character)

    public var description: String {
      switch self {
      case let .leadingNumber(d): return "path data starts with a number: \(d)"
      case let .trailingNumbers(d, count): return "path '\(d)' has \(count) trailing argument(s)"
      case let .unsupported(op): return "unsupported path command \(op)"
      }
    }
  }

  // MARK: - Internals

  /// A token is either a command letter or a number.
  private struct Token {
    let op: Character?
    let number: Double?
  }

  private static func tokens(_ d: String) -> [Token] {
    var out: [Token] = []
    var buffer = ""
    var seenDot = false

    func flush() {
      if !buffer.isEmpty, let value = Double(buffer) {
        out.append(Token(op: nil, number: value))
      }
      buffer = ""
      seenDot = false
    }

    for character in d {
      if character.isLetter {
        flush()
        out.append(Token(op: Character(character.uppercased()), number: nil))
        continue
      }
      if character == "." {
        // A second dot starts a new number: `1.5.5` is `1.5` then `0.5` per the
        // SVG grammar, and the file has no such case — flushing keeps the parser
        // honest instead of producing `1.55`.
        if seenDot { flush() }
        seenDot = true
        buffer.append(character)
        continue
      }
      if character.isNumber || character == "-" || character == "+" {
        // A sign after digits is a new number (`10-20` is `10`, `-20`).
        if (character == "-" || character == "+") && !buffer.isEmpty { flush() }
        buffer.append(character)
        continue
      }
      // Whitespace and commas separate.
      flush()
    }
    flush()
    return out
  }

  private static func arity(_ op: Character) -> Int {
    switch op {
    case "M", "L", "T": return 2
    case "H", "V": return 1
    case "Q", "S": return 4
    case "C": return 6
    case "A": return 7
    case "Z": return 0
    default: return -1
    }
  }

  private static func point(_ args: [Double], _ index: Int) -> CGPoint {
    CGPoint(x: args[index], y: args[index + 1])
  }
}

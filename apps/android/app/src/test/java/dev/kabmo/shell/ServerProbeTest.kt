package dev.kabmo.shell

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/**
 * The probe, against a real socket.
 *
 * A stub would prove nothing here: the whole job is a network round trip, and the
 * failures that matter — a refused connection, a non-2xx answer — are exactly
 * what a stub cannot produce.
 *
 * A raw `ServerSocket` rather than `com.sun.net.httpserver`: the Android unit
 * test classpath replaces the JDK with the platform stubs, so the `com.sun`
 * package is not there. `java.net` is, on both.
 */
class ServerProbeTest {

    private lateinit var server: ServerSocket
    private var running = true

    private fun serve(status: Int, body: String) {
        server = ServerSocket(0, 8, java.net.InetAddress.getByName("127.0.0.1"))
        thread(isDaemon = true) {
            while (running) {
                val socket: Socket = try {
                    server.accept()
                } catch (_: Exception) {
                    return@thread
                }
                socket.use {
                    // Read the request head so the client is not answered before
                    // it finished writing; the body is irrelevant.
                    val reader = it.getInputStream().bufferedReader()
                    while (true) {
                        val line = reader.readLine() ?: break
                        if (line.isEmpty()) break
                    }
                    val payload = body.toByteArray()
                    val head = "HTTP/1.1 $status X\r\n" +
                        "content-type: application/json\r\n" +
                        "content-length: ${payload.size}\r\n" +
                        "connection: close\r\n\r\n"
                    it.getOutputStream().apply {
                        write(head.toByteArray())
                        write(payload)
                        flush()
                    }
                }
            }
        }
    }

    @After
    fun stop() {
        running = false
        if (::server.isInitialized) server.close()
    }

    private fun origin() = "http://127.0.0.1:${server.localPort}"

    @Test
    fun measuresARoundTripToAHealthyServer() {
        serve(200, """{"ok":true,"service":"kabmo"}""")
        val rtt = ServerProbe.rttMs(origin())
        assertNotNull(rtt)
        assertEquals(true, (rtt ?: -1) >= 0)
    }

    @Test
    fun answersNullForANonSuccessStatus() {
        serve(401, """{"error":"UI authentication required"}""")
        assertNull(ServerProbe.rttMs(origin()))
    }

    @Test
    fun answersNullForARefusedConnection() {
        // Port 1 on loopback: nothing listens there, and the connect fails fast.
        assertNull(ServerProbe.rttMs("http://127.0.0.1:1"))
    }

    @Test
    fun picksTheOnlyReachableAddress() {
        serve(200, """{"ok":true}""")
        assertEquals(origin(), ServerProbe.best(listOf("http://127.0.0.1:1", origin())))
    }

    @Test
    fun answersNullWhenNothingAnswers() {
        assertNull(ServerProbe.best(listOf("http://127.0.0.1:1", "http://127.0.0.1:2")))
    }

    @Test
    fun collapsesDuplicateAddresses() {
        serve(200, """{"ok":true}""")
        assertEquals(origin(), ServerProbe.best(listOf(origin(), origin(), origin())))
    }
}

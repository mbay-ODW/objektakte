import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.Executors;
import org.mustangproject.validator.ZUGFeRDValidator;

/**
 * Minimaler HTTP-Dienst zur Prüfung von E-Rechnungen mit der Mustang-Bibliothek
 * (EN 16931, XRechnung, ZUGFeRD/Factur-X inkl. PDF/A-Prüfung per veraPDF).
 *
 * POST /validate  (Body: XML- oder PDF-Datei)  → Prüfbericht als XML,
 *                  Header X-Validation-Status: valid | invalid
 * GET  /health    → 200 ok
 */
public class Server {
  public static void main(String[] args) throws IOException {
    int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
    int maxBytes = Integer.parseInt(System.getenv().getOrDefault("MAX_BYTES", "26214400"));
    HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
    server.setExecutor(Executors.newFixedThreadPool(2));
    server.createContext("/health", ex -> respond(ex, 200, "text/plain", "ok", null));
    server.createContext("/validate", ex -> {
      if (!"POST".equals(ex.getRequestMethod())) {
        respond(ex, 405, "text/plain", "POST erwartet", null);
        return;
      }
      byte[] body = ex.getRequestBody().readNBytes(maxBytes + 1);
      if (body.length == 0 || body.length > maxBytes) {
        respond(ex, 413, "text/plain", "Datei fehlt oder ist zu groß", null);
        return;
      }
      boolean pdf = body.length > 4 && body[0] == '%' && body[1] == 'P' && body[2] == 'D' && body[3] == 'F';
      Path file = Files.createTempFile("einvoice-", pdf ? ".pdf" : ".xml");
      try {
        Files.write(file, body);
        ZUGFeRDValidator validator = new ZUGFeRDValidator();
        String report = validator.validate(file.toString());
        String status = report.contains("<summary status=\"valid\"/>") && !report.contains("status=\"invalid\"")
            ? "valid" : "invalid";
        respond(ex, 200, "application/xml; charset=utf-8", report, status);
      } catch (Exception e) {
        respond(ex, 500, "text/plain", "Prüfung fehlgeschlagen: " + e.getMessage(), null);
      } finally {
        Files.deleteIfExists(file);
      }
    });
    server.start();
    System.out.println("E-Rechnungs-Validator läuft auf Port " + port);
  }

  private static void respond(HttpExchange ex, int code, String type, String body, String status)
      throws IOException {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    ex.getResponseHeaders().set("Content-Type", type);
    if (status != null) ex.getResponseHeaders().set("X-Validation-Status", status);
    ex.sendResponseHeaders(code, bytes.length);
    try (OutputStream os = ex.getResponseBody()) {
      os.write(bytes);
    }
  }
}

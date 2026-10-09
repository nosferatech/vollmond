import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import java.util.List;
import java.util.Map;

/** Jackson 2.22.3 databind: numbers, duplicate keys and strictness. Run with run.sh. */
public class Survey {
  static String describe(JsonNode n) {
    if (n.isNumber()) {
      return n.numberType() + " " + n.numberValue().getClass().getSimpleName() + " text=" + n.asText() + " isIntegralNumber=" + n.isIntegralNumber();
    }
    return n.toString();
  }

  static void show(String label, ObjectMapper m, String text) {
    String result;
    try {
      result = describe(m.readTree(text));
    } catch (Exception e) {
      result = "ERROR " + e.getClass().getSimpleName() + ": " + e.getMessage().split("\n")[0];
    }
    System.out.printf("%-48s %s%n", label, result);
  }

  public static void main(String[] args) throws Exception {
    List<String> samples = List.of(
        "9007199254740991", "9007199254740993", "12345678901234567890", "18446744073709551616",
        "123456789012345678901234567890", "1", "1.0", "1e0", "-0", "-0.0", "1e400", "1e-400", "0.1",
        "0.3000000000000000444089209850062616169452667236328125", "123456789.123456789123456789");

    ObjectMapper plain = new ObjectMapper();
    ObjectMapper bigDecimal = JsonMapper.builder().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).build();
    ObjectMapper bigAll = JsonMapper.builder().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
        .enable(DeserializationFeature.USE_BIG_INTEGER_FOR_INTS).build();

    System.out.println("== readTree, default ObjectMapper");
    for (String s : samples) show(s, plain, s);
    System.out.println("\n== readTree, USE_BIG_DECIMAL_FOR_FLOATS");
    for (String s : samples) show(s, bigDecimal, s);

    System.out.println("\n== Equality and round trip in the tree model");
    String[][] pairs = {{"1", "1.0"}, {"1.0", "1.00"}, {"1e2", "100"}};
    for (String[] p : pairs) {
      System.out.printf("%s equals %s (default mapper)? %s; (BigDecimal mapper)? %s%n", p[0], p[1],
          plain.readTree(p[0]).equals(plain.readTree(p[1])), bigDecimal.readTree(p[0]).equals(bigDecimal.readTree(p[1])));
    }
    for (String s : new String[] {"1.0", "1e3", "0.10", "12345678901234567890", "-0", "1e400"}) {
      System.out.printf("write back %s: default %s; BigDecimal %s%n", s, plain.writeValueAsString(plain.readTree(s)),
          bigDecimal.writeValueAsString(bigDecimal.readTree(s)));
    }

    System.out.println("\n== Plain Java object binding (Map/Object)");
    for (String s : new String[] {"12345678901234567890", "1.0", "9007199254740993", "1e400"}) {
      Object o = plain.readValue(s, Object.class);
      System.out.printf("%s -> %s %s%n", s, o.getClass().getSimpleName(), o);
    }

    System.out.println("\n== Duplicate keys");
    show("tree, {\"a\":1,\"a\":2}", plain, "{\"a\":1,\"a\":2}");
    ObjectMapper strictDup = JsonMapper.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build();
    show("tree, STRICT_DUPLICATE_DETECTION", strictDup, "{\"a\":1,\"a\":2}");
    ObjectMapper failDup = JsonMapper.builder().enable(DeserializationFeature.FAIL_ON_READING_DUP_TREE_KEY).build();
    show("tree, FAIL_ON_READING_DUP_TREE_KEY", failDup, "{\"a\":1,\"a\":2}");

    System.out.println("\n== Strictness (default ObjectMapper)");
    String[][] probes = {{"NaN", "NaN"}, {"Infinity", "Infinity"}, {"trailing comma [1,]", "[1,]"}, {"comment", "[1 /* c */]"},
        {"leading zero 01", "01"}, {"+1", "+1"}, {".5", ".5"}, {"lone surrogate escape", "\"\\ud800\""}, {"two values", "1 2"}};
    for (String[] p : probes) show(p[0], plain, p[1]);
    try {
      plain.readTree("1 2");
      System.out.println("readTree of '1 2' returned the first value; trailing content ignored unless FAIL_ON_TRAILING_TOKENS");
    } catch (Exception e) {
      System.out.println("readTree of '1 2' failed");
    }
    ObjectMapper trailing = JsonMapper.builder().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    show("two values, FAIL_ON_TRAILING_TOKENS", trailing, "1 2");

    System.out.println("\n== Exact text of a number from the streaming parser");
    try (JsonParser p = plain.getFactory().createParser("[12345678901234567890, 1.0, 1e400, -0]")) {
      p.nextToken();
      while (p.nextToken() != com.fasterxml.jackson.core.JsonToken.END_ARRAY) {
        System.out.printf("getText=%s numberType=%s%n", p.getText(), p.getNumberType());
      }
    }
  }
}

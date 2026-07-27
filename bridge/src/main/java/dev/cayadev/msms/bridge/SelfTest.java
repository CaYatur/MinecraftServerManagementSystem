package dev.cayadev.msms.bridge;

/**
 * Prints one of every protocol v1 message, built with the same {@link Json}
 * helpers the plugin uses, so the app's parser can be run against real plugin
 * output without a Minecraft server anywhere in the loop.
 *
 * Deliberately includes hostile input - a name carrying a quote, a backslash, a
 * newline and a raw control character - because that is the case that turns a
 * message into two unparsable halves if the escaping is wrong.
 *
 * Not shipped: the build excludes this class from the plugin jar.
 */
public final class SelfTest {

    public static void main(String[] args) {
        final String marker = "[MSMS-BRIDGE]";
        final String nasty = "Ev\"il\\Na\nme";

        StringBuilder hello = new StringBuilder("{\"v\":1,\"t\":\"hello\"");
        Json.field(hello, "plugin", "MSMS-Bridge");
        Json.field(hello, "pluginVersion", "1.0.0");
        Json.field(hello, "server", "Paper");
        Json.field(hello, "mc", "1.21.4");
        hello.append(",\"interval\":5000}");
        System.out.println(marker + " " + hello);

        System.out.println(marker + " {\"v\":1,\"t\":\"tick\",\"tps\":" + Json.num(19.98)
                + ",\"tps5\":" + Json.num(19.9) + ",\"tps15\":" + Json.num(Double.NaN)
                + ",\"mspt\":" + Json.num(3.456) + "}");

        StringBuilder players = new StringBuilder("{\"v\":1,\"t\":\"players\",\"online\":1,\"list\":[{");
        players.append("\"name\":").append(Json.str(nasty));
        players.append(",\"uuid\":").append(Json.str("0-0-0-0-1"));
        players.append(",\"world\":").append(Json.str("world"));
        players.append(",\"dim\":").append(Json.str("overworld"));
        players.append(",\"x\":").append(Json.num(112.5));
        players.append(",\"y\":").append(Json.num(68));
        players.append(",\"z\":").append(Json.num(-40.25));
        players.append("}]}");
        System.out.println(marker + " " + players);

        StringBuilder ev = new StringBuilder("{\"v\":1,\"t\":\"event\",\"kind\":\"player.death\"");
        Json.field(ev, "text", nasty);
        ev.append(",\"data\":{\"player\":").append(Json.str(nasty)).append("}}");
        System.out.println(marker + " " + ev);

        System.out.println(marker + " {\"v\":1,\"t\":\"bye\"}");

        // The app must find the marker anywhere in the line, because Paper
        // routes System.out through log4j2 and prefixes every line.
        System.out.println("[12:34:56 INFO]: [STDOUT] " + marker + " {\"v\":1,\"t\":\"bye\"}");
    }
}

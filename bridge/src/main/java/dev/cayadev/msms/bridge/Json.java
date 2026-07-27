package dev.cayadev.msms.bridge;

/**
 * Minimal JSON writing, deliberately dependency-free.
 *
 * Split out of {@link MsmsBridge} so it can be exercised without a running
 * Minecraft server: {@link SelfTest} prints one of every message shape through
 * these helpers, and the repository's protocol parser reads them back. That is
 * the only part of the bridge whose correctness the app depends on.
 */
final class Json {

    private Json() {
    }

    /** JSON number, or `null` for anything not finite - NaN is not valid JSON. */
    static String num(double d) {
        if (Double.isNaN(d) || Double.isInfinite(d)) return "null";
        return String.valueOf(Math.round(d * 100.0) / 100.0);
    }

    /**
     * A quoted, escaped string. Control characters are escaped rather than
     * passed through: a raw newline in a player name would split the line and
     * the message would arrive as two unparsable halves.
     */
    static String str(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':
                    b.append("\\\"");
                    break;
                case '\\':
                    b.append("\\\\");
                    break;
                case '\n':
                    b.append("\\n");
                    break;
                case '\r':
                    b.append("\\r");
                    break;
                case '\t':
                    b.append("\\t");
                    break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    /** Append `,"key":"value"`, skipping a null value entirely. */
    static void field(StringBuilder b, String key, String value) {
        if (value == null) return;
        b.append(",\"").append(key).append("\":").append(str(value));
    }
}

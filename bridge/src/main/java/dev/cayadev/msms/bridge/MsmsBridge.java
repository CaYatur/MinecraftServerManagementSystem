package dev.cayadev.msms.bridge;

import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.List;

/**
 * MSMS Bridge - reports telemetry the console cannot otherwise expose.
 *
 * Transport is the server's own standard output: one marked line per message.
 * That needs no port, no socket, no firewall rule and no credentials, and it
 * works identically for a LAN server, a box behind NAT, and a host with every
 * port closed. See docs/bridge-protocol.md for the wire format.
 *
 * Everything here runs on the main thread and does almost nothing: reading the
 * tick rate and the player list must not itself become a source of lag.
 */
public final class MsmsBridge extends JavaPlugin implements Listener {

    private static final String MARKER = "[MSMS-BRIDGE]";
    private static final int PROTOCOL = 1;

    private long intervalMs;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        int seconds = Math.max(1, getConfig().getInt("interval-seconds", 5));
        this.intervalMs = seconds * 1000L;

        emitHello();
        getServer().getPluginManager().registerEvents(this, this);

        // Sync, because the player list and their locations are main-thread
        // state. The work is a handful of field reads every few seconds.
        long ticks = seconds * 20L;
        getServer().getScheduler().runTaskTimer(this, this::heartbeat, ticks, ticks);
    }

    @Override
    public void onDisable() {
        emit("{\"v\":" + PROTOCOL + ",\"t\":\"bye\"}");
    }

    // ---- messages ----

    private void emitHello() {
        StringBuilder b = new StringBuilder();
        b.append("{\"v\":").append(PROTOCOL).append(",\"t\":\"hello\"");
        Json.field(b, "plugin", getName());
        // getDescription() rather than getPluginMeta(), and getBukkitVersion()
        // rather than getMinecraftVersion(): both of the shorter calls are
        // Paper-only additions, and using them would make the plugin throw
        // NoSuchMethodError on Spigot at the first heartbeat - on a server that
        // is otherwise perfectly capable of running it.
        Json.field(b, "pluginVersion", getDescription().getVersion());
        Json.field(b, "server", getServer().getName());
        Json.field(b, "mc", minecraftVersion());
        b.append(",\"interval\":").append(intervalMs);
        b.append("}");
        emit(b.toString());
    }

    private void heartbeat() {
        emitTick();
        emitPlayers();
    }

    private void emitTick() {
        double[] tps = getServer().getTPS();
        StringBuilder b = new StringBuilder();
        b.append("{\"v\":").append(PROTOCOL).append(",\"t\":\"tick\"");
        // The app treats these as reported and does no clamping, so a warming-up
        // server showing 20.4 stays visible rather than being tidied away.
        b.append(",\"tps\":").append(Json.num(tps.length > 0 ? tps[0] : Double.NaN));
        b.append(",\"tps5\":").append(Json.num(tps.length > 1 ? tps[1] : Double.NaN));
        b.append(",\"tps15\":").append(Json.num(tps.length > 2 ? tps[2] : Double.NaN));
        b.append(",\"mspt\":").append(Json.num(getServer().getAverageTickTime()));
        b.append("}");
        emit(b.toString());
    }

    private void emitPlayers() {
        List<? extends Player> online = List.copyOf(getServer().getOnlinePlayers());
        StringBuilder b = new StringBuilder();
        b.append("{\"v\":").append(PROTOCOL).append(",\"t\":\"players\",\"online\":").append(online.size());
        b.append(",\"list\":[");
        boolean first = true;
        for (Player p : online) {
            if (!first) b.append(',');
            first = false;
            Location loc = p.getLocation();
            World w = loc.getWorld();
            b.append('{');
            b.append("\"name\":").append(Json.str(p.getName()));
            b.append(",\"uuid\":").append(Json.str(p.getUniqueId().toString()));
            if (w != null) {
                b.append(",\"world\":").append(Json.str(w.getName()));
                b.append(",\"dim\":").append(Json.str(dimension(w)));
            }
            b.append(",\"x\":").append(Json.num(loc.getX()));
            b.append(",\"y\":").append(Json.num(loc.getY()));
            b.append(",\"z\":").append(Json.num(loc.getZ()));
            b.append('}');
        }
        b.append("]}");
        emit(b.toString());
    }

    @EventHandler
    public void onDeath(PlayerDeathEvent e) {
        // A death is exactly the kind of thing the console cannot report in a
        // structured way - the death message is free text and locale-dependent.
        Player p = e.getEntity();
        Location loc = p.getLocation();
        World w = loc.getWorld();
        StringBuilder b = new StringBuilder();
        b.append("{\"v\":").append(PROTOCOL).append(",\"t\":\"event\",\"kind\":\"player.death\"");
        Json.field(b, "text", p.getName());
        b.append(",\"data\":{");
        b.append("\"player\":").append(Json.str(p.getName()));
        if (w != null) b.append(",\"world\":").append(Json.str(w.getName()));
        b.append(",\"x\":").append(Json.num(loc.getX()));
        b.append(",\"y\":").append(Json.num(loc.getY()));
        b.append(",\"z\":").append(Json.num(loc.getZ()));
        b.append("}}");
        emit(b.toString());
    }

    // ---- plumbing ----

    /**
     * `getBukkitVersion()` is `1.21.4-R0.1-SNAPSHOT`; the protocol wants the
     * plain Minecraft version. Everything before the first `-`.
     */
    private String minecraftVersion() {
        String v = getServer().getBukkitVersion();
        int dash = v.indexOf('-');
        return dash > 0 ? v.substring(0, dash) : v;
    }

    private static String dimension(World w) {
        switch (w.getEnvironment()) {
            case NETHER:
                return "nether";
            case THE_END:
                return "the_end";
            default:
                return "overworld";
        }
    }

    /**
     * One message per line. A newline inside the payload would split the
     * message, so every string is escaped and nothing is pretty-printed.
     *
     * Through the plugin logger rather than System.out. The transport is still
     * the server console — that is the whole design, and it is why no extra
     * port is opened — but Paper nags about System.out.print and it is right to:
     * a plugin writing to the raw stream bypasses the log file, the timestamps
     * and every appender an operator has configured. The manager finds the line
     * by its marker, which survives the logger's own prefix untouched.
     */
    private void emit(String json) {
        getLogger().info(MARKER + " " + json);
    }

}

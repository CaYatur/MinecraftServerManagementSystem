export type PropType = 'bool' | 'int' | 'string' | 'enum'

export type PropCategory =
  | 'general'
  | 'world'
  | 'players'
  | 'gameplay'
  | 'network'
  | 'performance'
  | 'security'

export interface PropMeta {
  key: string
  type: PropType
  category: PropCategory
  options?: string[]
  desc: string
}

export const PROP_CATEGORIES: PropCategory[] = [
  'general',
  'world',
  'players',
  'gameplay',
  'network',
  'performance',
  'security'
]

/** Curated metadata for the common vanilla server.properties keys. */
export const PROPERTY_META: PropMeta[] = [
  // general
  { key: 'motd', type: 'string', category: 'general', desc: 'Message shown in the server list.' },
  { key: 'server-port', type: 'int', category: 'network', desc: 'TCP port the server listens on (default 25565).' },
  { key: 'server-ip', type: 'string', category: 'network', desc: 'Bind to a specific IP. Leave empty for all interfaces.' },
  { key: 'enable-status', type: 'bool', category: 'network', desc: 'Reply to server-list pings.' },
  { key: 'hide-online-players', type: 'bool', category: 'network', desc: 'Hide the player list from status pings.' },

  // world
  { key: 'level-name', type: 'string', category: 'world', desc: 'World folder name.' },
  { key: 'level-seed', type: 'string', category: 'world', desc: 'Seed for world generation.' },
  { key: 'level-type', type: 'enum', category: 'world', options: ['minecraft:normal', 'minecraft:flat', 'minecraft:large_biomes', 'minecraft:amplified', 'minecraft:single_biome_surface'], desc: 'World generation type.' },
  { key: 'generate-structures', type: 'bool', category: 'world', desc: 'Generate structures (villages, temples…).' },
  { key: 'max-world-size', type: 'int', category: 'world', desc: 'World border radius in blocks.' },
  { key: 'allow-nether', type: 'bool', category: 'world', desc: 'Allow travel to the Nether.' },
  { key: 'spawn-monsters', type: 'bool', category: 'world', desc: 'Spawn hostile mobs.' },
  { key: 'spawn-animals', type: 'bool', category: 'world', desc: 'Spawn passive animals.' },
  { key: 'spawn-npcs', type: 'bool', category: 'world', desc: 'Spawn villagers.' },

  // gameplay
  { key: 'gamemode', type: 'enum', category: 'gameplay', options: ['survival', 'creative', 'adventure', 'spectator'], desc: 'Default game mode for joining players.' },
  { key: 'force-gamemode', type: 'bool', category: 'gameplay', desc: 'Force players to the default game mode on join.' },
  { key: 'difficulty', type: 'enum', category: 'gameplay', options: ['peaceful', 'easy', 'normal', 'hard'], desc: 'World difficulty.' },
  { key: 'hardcore', type: 'bool', category: 'gameplay', desc: 'Hardcore mode (ban on death).' },
  { key: 'pvp', type: 'bool', category: 'gameplay', desc: 'Allow player-vs-player combat.' },
  { key: 'allow-flight', type: 'bool', category: 'gameplay', desc: 'Allow flight (for mods/creative). Prevents some anti-cheat kicks.' },
  { key: 'enable-command-block', type: 'bool', category: 'gameplay', desc: 'Enable command blocks.' },

  // players
  { key: 'max-players', type: 'int', category: 'players', desc: 'Maximum simultaneous players.' },
  { key: 'online-mode', type: 'bool', category: 'security', desc: 'Verify players with Mojang (ON = premium only, OFF = cracked/offline allowed).' },
  { key: 'white-list', type: 'bool', category: 'players', desc: 'Enable the whitelist.' },
  { key: 'enforce-whitelist', type: 'bool', category: 'players', desc: 'Kick non-whitelisted players when the whitelist reloads.' },
  { key: 'player-idle-timeout', type: 'int', category: 'players', desc: 'Kick idle players after N minutes (0 = never).' },
  { key: 'spawn-protection', type: 'int', category: 'players', desc: 'Spawn protection radius (0 = disabled).' },
  { key: 'op-permission-level', type: 'enum', category: 'security', options: ['1', '2', '3', '4'], desc: 'Permission level granted to operators.' },
  { key: 'function-permission-level', type: 'enum', category: 'security', options: ['1', '2', '3', '4'], desc: 'Permission level for functions/datapacks.' },

  // network / performance
  { key: 'view-distance', type: 'int', category: 'performance', desc: 'Chunk render distance sent to clients.' },
  { key: 'simulation-distance', type: 'int', category: 'performance', desc: 'Chunk simulation (ticking) distance.' },
  { key: 'network-compression-threshold', type: 'int', category: 'network', desc: 'Compress packets over N bytes (-1 disables).' },
  { key: 'max-tick-time', type: 'int', category: 'performance', desc: 'Watchdog: crash if a tick exceeds N ms (-1 disables).' },
  { key: 'entity-broadcast-range-percentage', type: 'int', category: 'performance', desc: 'Entity tracking range as a percentage.' },
  { key: 'sync-chunk-writes', type: 'bool', category: 'performance', desc: 'Synchronous chunk writes (safer, slower).' },
  { key: 'use-native-transport', type: 'bool', category: 'performance', desc: 'Use Linux-native transport for higher throughput.' },

  // security
  { key: 'enable-rcon', type: 'bool', category: 'security', desc: 'Enable remote console (RCON).' },
  { key: 'rcon.port', type: 'int', category: 'security', desc: 'RCON port.' },
  { key: 'rcon.password', type: 'string', category: 'security', desc: 'RCON password.' },
  { key: 'enable-query', type: 'bool', category: 'security', desc: 'Enable the GameSpy4 query protocol.' },
  { key: 'query.port', type: 'int', category: 'security', desc: 'Query port.' },
  { key: 'broadcast-console-to-ops', type: 'bool', category: 'security', desc: 'Send console command output to online ops.' },
  { key: 'resource-pack', type: 'string', category: 'general', desc: 'URL of a server resource pack.' },
  { key: 'require-resource-pack', type: 'bool', category: 'general', desc: 'Kick players who reject the resource pack.' }
]

export const PROP_META_MAP: Record<string, PropMeta> = Object.fromEntries(
  PROPERTY_META.map((m) => [m.key, m])
)

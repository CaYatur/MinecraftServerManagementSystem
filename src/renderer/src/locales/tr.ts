import type en from './en'

const tr: typeof en = {
  app: { title: 'Minecraft Sunucu Yöneticisi', subtitle: 'Taşınabilir kontrol paneli' },
  nav: {
    dashboard: 'Panel',
    console: 'Konsol',
    properties: 'Sunucu Ayarları',
    files: 'Dosya Düzenleyici',
    players: 'Oyuncular',
    plugins: 'Eklentiler / Modlar',
    backups: 'Yedekler',
    scheduler: 'Zamanlayıcı',
    crash: 'Çökme Analizi',
    settings: 'Ayarlar'
  },
  sidebar: {
    servers: 'Sunucular',
    scan: 'Klasörü tara',
    addExisting: 'Var olanı ekle',
    create: 'Sunucu oluştur',
    noServers: 'Henüz sunucu yok',
    noServersHint: 'Başlamak için yeni bir sunucu oluşturun veya var olan bir klasörü ekleyin.',
    settings: 'Ayarlar',
    openFolder: 'Klasörü aç'
  },
  status: {
    stopped: 'Durdu',
    starting: 'Başlatılıyor',
    running: 'Çalışıyor',
    stopping: 'Durduruluyor',
    crashed: 'Çöktü'
  },
  controls: {
    start: 'Başlat',
    stop: 'Durdur',
    restart: 'Yeniden başlat',
    kill: 'Zorla kapat',
    commandPlaceholder: 'Bir komut yazın (örn. say merhaba) ve Enter’a basın',
    send: 'Gönder',
    stopImmediate: 'Hemen durdur',
    confirmKillTitle: 'Sunucu zorla kapatılsın mı?',
    confirmKillBody: 'Bu, süreci kaydetmeden anında sonlandırır. Yalnızca sunucu donduğunda kullanın.'
  },
  console: {
    title: 'Konsol',
    clear: 'Temizle',
    autoscroll: 'Otomatik kaydır',
    empty: 'Henüz çıktı yok. Canlı günlükleri görmek için sunucuyu başlatın.',
    copy: 'Kopyala'
  },
  dashboard: {
    title: 'Panel',
    cpu: 'İşlemci',
    ram: 'Bellek',
    tps: 'TPS',
    players: 'Oyuncular',
    uptime: 'Çalışma süresi',
    version: 'Sürüm',
    type: 'Yazılım',
    notRunning: 'Sunucu çalışmıyor',
    notRunningHint: 'Canlı istatistikleri görmek için sunucuyu başlatın.',
    tpsNA: 'TPS yalnızca Paper tabanlı sunucularda gösterilir',
    world: 'Dünya boyutu',
    quickActions: 'Hızlı işlemler'
  },
  settings: {
    title: 'Ayarlar',
    appearance: 'Görünüm',
    language: 'Dil',
    languageAuto: 'Otomatik (sistem)',
    theme: 'Tema',
    themeDark: 'Koyu',
    themeLight: 'Açık',
    themeSystem: 'Sistem',
    java: 'Java',
    javaPath: 'Java yolu (otomatik algılama için boş bırakın)',
    javaAuto: 'Otomatik algıla',
    detectedJava: 'Algılanan Java',
    notDetected: 'Algılanamadı',
    defaults: 'Yeni sunucu varsayılanları',
    maxMemory: 'Maksimum bellek (MB)',
    minMemory: 'Minimum bellek (MB)',
    preset: 'JVM ön ayarı',
    stopCountdown: 'Durdurma geri sayımı (saniye)',
    autoEnableRcon: 'Sunucularda RCON’u otomatik etkinleştir',
    baseDir: 'Veri / çalışma dizini',
    about: 'Hakkında',
    aboutBody: 'Taşınabilir, açık kaynaklı Minecraft sunucu yöneticisi. Tüm veriler uygulamanın yanında saklanır.',
    version: 'Sürüm'
  },
  server: {
    add: 'Var olan sunucuyu ekle',
    remove: 'Kaldır',
    removeTitle: 'Sunucu kaldırılsın mı?',
    removeBody: '"{{name}}" yöneticiden kaldırılacak. Bu, hiçbir dosyayı silmez.',
    removeWithFiles: 'Ayrıca tüm sunucu dosyalarını diskten sil (geri alınamaz)',
    rename: 'Yeniden adlandır',
    memory: 'Bellek',
    args: 'Başlatma argümanları',
    editArgs: 'Başlatma argümanlarını düzenle'
  },
  args: {
    title: 'Başlatma argümanları',
    preset: 'Ön ayar',
    maxMemory: 'Maksimum bellek (MB)',
    minMemory: 'Minimum bellek (MB)',
    jarFile: 'Sunucu jar dosyası',
    extraFlags: 'Ek bayraklar',
    customArgs: 'Özel argümanlar ("java" sonrası tam komut)',
    nogui: '"nogui" ekle',
    preview: 'Komut önizlemesi',
    javaPath: 'Java yolu geçersiz kılma'
  },
  create: {
    title: 'Yeni sunucu oluştur',
    comingSoon: 'Tam oluşturma sihirbazı (canlı sürüm çekme) Oluştur sekmesinde yer alır.'
  },
  common: {
    save: 'Kaydet',
    cancel: 'İptal',
    browse: 'Gözat…',
    confirm: 'Onayla',
    delete: 'Sil',
    yes: 'Evet',
    no: 'Hayır',
    close: 'Kapat',
    loading: 'Yükleniyor…',
    refresh: 'Yenile',
    apply: 'Uygula',
    saved: 'Kaydedildi'
  },
  types: {
    vanilla: 'Vanilya',
    paper: 'Paper',
    folia: 'Folia',
    purpur: 'Purpur',
    spigot: 'Spigot',
    bukkit: 'Bukkit',
    fabric: 'Fabric',
    quilt: 'Quilt',
    forge: 'Forge',
    neoforge: 'NeoForge',
    mohist: 'Mohist',
    arclight: 'Arclight',
    velocity: 'Velocity',
    waterfall: 'Waterfall',
    bungeecord: 'BungeeCord',
    unknown: 'Bilinmiyor'
  },
  toast: {
    scanDone: 'Tarama tamamlandı — {{count}} sunucu kaydedildi',
    added: 'Sunucu eklendi',
    notAServer: 'Bu klasör bir Minecraft sunucusuna benzemiyor',
    startFailed: 'Sunucu başlatılamadı',
    saved: 'Ayarlar kaydedildi'
  }
}

export default tr

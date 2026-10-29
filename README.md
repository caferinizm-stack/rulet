# Retra · Rulet (Web)

Canlı **Avrupa ruleti** (0–36, tek sıfır). Herkes **aynı masada** oynar:
20 sn bahis → çark 9 sn döner → 6 sn sonuç → yeni tur. Bahisler uygulamanın
gerçek kristalleriyle (`profiles.crystals`) yapılır. Derleme adımı yoktur:
`index.html` + `style.css` + `app.js` + `assets/`.

## Kurulum

1. **Sunucu:** `sql_kopyala.html` ▸ **FAZ 75: RULET** bölümünü Supabase SQL
   Editor'de bir kez çalıştır (`supabase_faz75_rulet.sql`). Tabloları,
   fonksiyonları, kazanç duyurusunu, admin gizleme satırını ve (pg_cron varsa)
   5 saniyelik tur zamanlayıcısını kurar.
2. **Yayın:** bu klasörün içeriğini GitHub'da **`rulet`** adlı depoya yükle ve
   Settings ▸ Pages ▸ Branch: `main` / `(root)` seç. Adres:
   `https://caferinizm-stack.github.io/rulet/`
   (başka bir adres kullanırsan `lib/screens/roulette_screen.dart` ▸
   `kRouletteUrl` sabitini değiştir).
3. Uygulama: Şans Oyunları ▸ **Rulet** kartı ya da odadaki şans oyunları
   menüsü. Sayfa `?app=1` ile açılır, oturum adresin `#` kısmından gelir,
   giriş ekranı çıkmaz.

`?demo=1` ile sunucusuz deneme modu açılır (bakiye tarayıcıda, sahte
oyuncular). Yerelde: `python3 -m http.server` → `http://127.0.0.1:8000/?demo=1`.

## Kurallar

| Bahis | Ödeme (bahis dahil) |
| --- | --- |
| Tek sayı (0–36) | 36× |
| Düzine (1-12 · 13-24 · 25-36) | 3× |
| Kolon (2:1) | 3× |
| Kırmızı / Siyah · Tek / Çift · 1-18 / 19-36 | 2× |

0 gelirse dış bahisler kaybeder. Tek çip en fazla 1.000.000, bir turda kişi
başına en fazla 20.000.000 kristal.

## Güvenlik

* Sonuç **yalnız sunucuda** ve **bahisler kapandıktan sonra** üretilir
  (`roulette_draw`: `gen_random_uuid` baytlarından reddetme örneklemesiyle eşit
  olasılıklı 0–36). Bahis süresince istemciye hiç gönderilmez.
* Bakiye satırı `for update` ile kilitlenerek düşer; tutar, tür ve sınırlar
  sunucuda denetlenir. İstemcinin gönderdiği hiçbir alan (bakiye, sonuç,
  ödeme) güvenilir kabul edilmez.
* Çark animasyonu sunucu saatine bağlıdır: herkes aynı anda aynı sayıyı görür.

## Uygulama köprüsü (`RetraGame`)

* `ready` — sayfa hazır (açılış animasyonu kapanır).
* `win:<kristal>` — bu tur kazanılan toplam (duyuruyu sunucu yapar).
* `lowbalance` — bakiye yetersiz.

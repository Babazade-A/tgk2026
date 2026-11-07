# Kongrem'e kongre ekleme / programı güncelleme

Kongre programları `data/v1/` klasöründeki JSON dosyalarıdır. Uygulamanın koduna dokunmadan kongre eklenir ve program güncellenir. Yüklü uygulamalar değişikliği açılışta kendiliğinden alır; mağaza güncellemesi gerekmez.

## Yeni kongre eklemek

1. `tools/sablon-kongre.json` dosyasını `data/v1/<kimlik>.json` olarak kopyalayın. Kimlik küçük harf, rakam ve tire: ör. `balkan2027`.
2. Doldurun:
   - `id`: dosya adıyla aynı kimlik.
   - `short`: kısa ad (sekmede ve takvimde görünür), ör. `BALKAN 2027`.
   - `name`, `dates`: Türkçe ve İngilizce. Yalnızca bir dil varsa diğeri boş bırakılabilir; olan gösterilir.
   - `utcOffsetMin`: kongrenin yapıldığı yerin saat farkı dakika olarak (Türkiye 180, Bulgaristan/Yunanistan kışın 120, yazın 180). "Şimdi / Sıradaki" ve hatırlatmalar buna göre hesaplanır.
   - `days`: her gün için kısa anahtar (`k`), tarih (`YYYY-AA-GG`) ve görünen ad.
   - `items`: programdaki her oturum. `type`: `cer` (tören), `conf` (konferans), `talk` (konuşma), `sym` (uydu sempozyumu), `sel` (seçilmiş bildiriler), `course` (kurs), `panel`, `break` (mola). Ana salon dışındaki oturumlara `room` yazın.
   - `oral`: sözlü bildiri oturumları (yoksa bu bölümü tamamen silin). Saatler `start` + sıra × `minutesPerTalk` ile yaklaşık hesaplanır.
3. `data/v1/conferences.json` listesine kongreyi ekleyin (`id`, `short`, `name`, `dates`, `venue`, `start`, `end`, `rev`).
4. Denetleyin: `node tools/validate.mjs --canli`. Hata varsa yayına almayın.
5. Kaydedip GitHub'a gönderin (commit + push). Birkaç dakika içinde yayında olur; uygulamalar açılışta yeni kongreyi görür. Birden fazla kongre olunca uygulama kongre listesini gösterir.

## Programı güncellemek

1. İlgili `data/v1/<kimlik>.json` dosyasını düzenleyin.
2. **`rev` sayısını 1 artırın** (ve `updated` tarihini değiştirin). Artırmazsanız yüklü uygulamalar güncellemeyi almaz; denetleyici bunu yakalar.
3. **Kodları (`id`) değiştirmeyin ve silmeyin.** Katılımcıların seçimleri ve notları bu kodlara bağlıdır. Bir oturum iptal olduysa başlığına "(İPTAL)" ekleyin; yeni oturum için yeni bir kod verin.
4. `node tools/validate.mjs --canli` → hata yoksa commit + push.

## Güvenlik notları

- Dosyalardaki metinler uygulamada düz metin olarak gösterilir; HTML ya da kod çalışmaz.
- Bu dosyaları değiştirebilen tek yer GitHub hesabıdır: hesapta iki adımlı doğrulama açık olmalı.
- Biçimde eski uygulamaların okuyamayacağı bir değişiklik gerekirse yeni dosyalar `data/v2/` altına konur; `data/v1/` eski sürümler için yerinde kalır.

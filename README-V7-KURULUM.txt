ROTA YKS v7 — GELİŞTİRME PAKETİ KURULUM NOTU

ÖNEMLİ: Bu paket geliştirme kopyasıdır. Canlı Vercel sürümüne dağıtılmadı ve mevcut Supabase veritabanında değişiklik yapılmadı.

DOSYALAR
- index.html: ana uygulama.
- api/: Vercel API uçları.
- vercel.json: Vercel yapılandırması.
- mufredat-katalogu.json: kaynak kataloğu.
- sql/ortak-plan-sistemi.sql: arkadaş bağlantısı ve ortak görev sistemi için yeni tablolar.

MEVCUT VERİYİ KORUMA
1. Mevcut `yks_user_data` tablosunu silme veya yeniden oluşturma.
2. Yayına geçmeden önce Supabase verilerinin yedeğini al.
3. Ortak planı etkinleştirmek için yeni SQL dosyası gerekir. Bu SQL mevcut çalışma verisi tablosuna dokunmaz; fakat yine de önce ayrı/test Supabase projesinde denemek en güvenlisidir.
4. SQL migration başarıyla uygulanmadan uygulamada Ortak Plan butonları çalışmaz; ekran tanılama mesajı gösterir.

TEST SIRASI
1. İki ayrı hesapla giriş yap.
2. Bir hesaptan diğer hesaba e-posta daveti gönder; ikinci hesap Ortak Plan ekranında daveti kabul etsin.
3. Görev alacak hesap, kitaplığını açıkça paylaşsın.
4. Görev atayan hesap 7 günlük program oluşturup birkaç güne test, video ve serbest not eklesin.
5. Görev alan hesap takvimde görevi tamamlasın, başka bir görevi 1 gün veya 2 gün ertelesin.
6. Görev atayan hesapta durumların yenilendiğini; kendi kişisel görevlerinin ve takviminin değişmediğini kontrol et.
7. Mobil görünümde alt menüyü yana kaydır; tüm sekmelere erişildiğini doğrula.
8. Günlük “Rutinini unutma” penceresini kapat; aynı gün yeniden görünmediğini ve ertesi gün tekrar çıktığını kontrol et.

YAYINLAMA
Yukarıdaki testler tamamlanmadan canlı Vercel projesine dosya kopyalama veya canlı veritabanına migration uygulama. Paket, yayına hazır olduğu iddiası değil, geliştirme aşamasındaki sürümdür.

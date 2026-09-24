(() => {
  "use strict";

  const STORAGE_KEY = "watchtogether-language";
  const DEFAULT_LOCALE = "zh-TW";
  const SUPPORTED = [
    "zh-TW","zh-CN","en","ja","ko","es","fr","de",
    "pt-BR","ru","it","th","vi","id","tr","ar"
  ];

  const LANGUAGE_NAMES = {
    "zh-TW":"繁體中文",
    "zh-CN":"简体中文",
    "en":"English",
    "ja":"日本語",
    "ko":"한국어",
    "es":"Español",
    "fr":"Français",
    "de":"Deutsch",
    "pt-BR":"Português (Brasil)",
    "ru":"Русский",
    "it":"Italiano",
    "th":"ไทย",
    "vi":"Tiếng Việt",
    "id":"Bahasa Indonesia",
    "tr":"Türkçe",
    "ar":"العربية"
  };

  const ZH = {
    "WatchTogether｜一起看": {
      "zh-TW":"WatchTogether｜一起看","zh-CN":"WatchTogether｜一起看","en":"WatchTogether｜Watch Together","ja":"WatchTogether｜一緒に見る","ko":"WatchTogether｜함께 보기","es":"WatchTogether｜Ver juntos","fr":"WatchTogether｜Regarder ensemble","de":"WatchTogether｜Gemeinsam ansehen","pt-BR":"WatchTogether｜Assistir juntos","ru":"WatchTogether｜Смотрим вместе","it":"WatchTogether｜Guardiamo insieme","th":"WatchTogether｜ดูด้วยกัน","vi":"WatchTogether｜Xem cùng nhau","id":"WatchTogether｜Nonton bersama","tr":"WatchTogether｜Birlikte izle","ar":"WatchTogether｜شاهدوا معًا"
    },
    "Google 登入": {
      "zh-TW":"Google 登入","zh-CN":"Google 登录","en":"Sign in with Google","ja":"Google でログイン","ko":"Google 로그인","es":"Iniciar sesión con Google","fr":"Se connecter avec Google","de":"Mit Google anmelden","pt-BR":"Entrar com Google","ru":"Войти через Google","it":"Accedi con Google","th":"เข้าสู่ระบบด้วย Google","vi":"Đăng nhập Google","id":"Masuk dengan Google","tr":"Google ile giriş yap","ar":"تسجيل الدخول باستخدام Google"
    },
    "帳號":{"zh-TW":"帳號","zh-CN":"账号","en":"Account","ja":"アカウント","ko":"계정","es":"Cuenta","fr":"Compte","de":"Konto","pt-BR":"Conta","ru":"Аккаунт","it":"Account","th":"บัญชี","vi":"Tài khoản","id":"Akun","tr":"Hesap","ar":"الحساب"},
    "登出":{"zh-TW":"登出","zh-CN":"退出登录","en":"Sign out","ja":"ログアウト","ko":"로그아웃","es":"Cerrar sesión","fr":"Se déconnecter","de":"Abmelden","pt-BR":"Sair","ru":"Выйти","it":"Esci","th":"ออกจากระบบ","vi":"Đăng xuất","id":"Keluar","tr":"Çıkış yap","ar":"تسجيل الخروج"},
    "一起看":{"zh-TW":"一起看","zh-CN":"一起看","en":"Watch Together","ja":"一緒に見る","ko":"함께 보기","es":"Ver juntos","fr":"Regarder ensemble","de":"Gemeinsam ansehen","pt-BR":"Assistir juntos","ru":"Смотрим вместе","it":"Guardiamo insieme","th":"ดูด้วยกัน","vi":"Xem cùng nhau","id":"Nonton bersama","tr":"Birlikte izle","ar":"شاهدوا معًا"},
    "影片":{"zh-TW":"影片","zh-CN":"视频","en":"Video","ja":"動画","ko":"영상","es":"Vídeo","fr":"Vidéo","de":"Video","pt-BR":"Vídeo","ru":"Видео","it":"Video","th":"วิดีโอ","vi":"Video","id":"Video","tr":"Video","ar":"فيديو"},
    "直播":{"zh-TW":"直播","zh-CN":"直播","en":"Live","ja":"ライブ","ko":"라이브","es":"Directo","fr":"Direct","de":"Live","pt-BR":"Ao vivo","ru":"Стрим","it":"Live","th":"ไลฟ์","vi":"Trực tiếp","id":"Live","tr":"Canlı","ar":"مباشر"},
    "串流":{"zh-TW":"串流","zh-CN":"流媒体","en":"Streaming","ja":"ストリーミング","ko":"스트리밍","es":"Streaming","fr":"Streaming","de":"Streaming","pt-BR":"Streaming","ru":"Стриминг","it":"Streaming","th":"สตรีมมิง","vi":"Phát trực tuyến","id":"Streaming","tr":"Yayın","ar":"بث"},
    "動漫":{"zh-TW":"動漫","zh-CN":"动漫","en":"Anime","ja":"アニメ","ko":"애니메이션","es":"Anime","fr":"Anime","de":"Anime","pt-BR":"Anime","ru":"Аниме","it":"Anime","th":"อนิเมะ","vi":"Anime","id":"Anime","tr":"Anime","ar":"أنمي"},
    "成員":{"zh-TW":"成員","zh-CN":"成员","en":"Members","ja":"メンバー","ko":"멤버","es":"Miembros","fr":"Membres","de":"Mitglieder","pt-BR":"Membros","ru":"Участники","it":"Membri","th":"สมาชิก","vi":"Thành viên","id":"Anggota","tr":"Üyeler","ar":"الأعضاء"},
    "尚未同步":{"zh-TW":"尚未同步","zh-CN":"尚未同步","en":"Not synced yet","ja":"まだ同期されていません","ko":"아직 동기화되지 않음","es":"Aún no sincronizado","fr":"Pas encore synchronisé","de":"Noch nicht synchronisiert","pt-BR":"Ainda não sincronizado","ru":"Ещё не синхронизировано","it":"Non ancora sincronizzato","th":"ยังไม่ซิงก์","vi":"Chưa đồng bộ","id":"Belum disinkronkan","tr":"Henüz senkronize değil","ar":"لم تتم المزامنة بعد"},
    "📋 待播放清單":{"zh-TW":"📋 待播放清單","zh-CN":"📋 待播放列表","en":"📋 Queue","ja":"📋 再生キュー","ko":"📋 재생 대기열","es":"📋 Cola de reproducción","fr":"📋 File d’attente","de":"📋 Warteschlange","pt-BR":"📋 Fila","ru":"📋 Очередь","it":"📋 Coda","th":"📋 คิว","vi":"📋 Danh sách chờ","id":"📋 Antrean","tr":"📋 Sıra","ar":"📋 قائمة الانتظار"},
    "播放下一部":{"zh-TW":"播放下一部","zh-CN":"播放下一部","en":"Play next","ja":"次を再生","ko":"다음 재생","es":"Reproducir siguiente","fr":"Lire ensuite","de":"Nächstes abspielen","pt-BR":"Reproduzir próxima","ru":"Воспроизвести следующую","it":"Riproduci la prossima","th":"เล่นรายการถัดไป","vi":"Phát tiếp theo","id":"Putar berikutnya","tr":"Sonrakini oynat","ar":"تشغيل التالي"},
    "影片網址或 ID":{"zh-TW":"影片網址或 ID","zh-CN":"视频网址或 ID","en":"Video URL or ID","ja":"動画URLまたはID","ko":"영상 URL 또는 ID","es":"URL o ID del vídeo","fr":"URL ou ID de la vidéo","de":"Video-URL oder ID","pt-BR":"URL ou ID do vídeo","ru":"URL или ID видео","it":"URL o ID del video","th":"URL หรือ ID วิดีโอ","vi":"URL hoặc ID video","id":"URL atau ID video","tr":"Video URL'si veya ID","ar":"رابط الفيديو أو المعرّف"},
    "修改名稱":{"zh-TW":"修改名稱","zh-CN":"修改名称","en":"Change name","ja":"名前を変更","ko":"이름 변경","es":"Cambiar nombre","fr":"Modifier le nom","de":"Namen ändern","pt-BR":"Alterar nome","ru":"Изменить имя","it":"Modifica nome","th":"เปลี่ยนชื่อ","vi":"Đổi tên","id":"Ubah nama","tr":"Adı değiştir","ar":"تغيير الاسم"},
    "名稱":{"zh-TW":"名稱","zh-CN":"名称","en":"Name","ja":"名前","ko":"이름","es":"Nombre","fr":"Nom","de":"Name","pt-BR":"Nome","ru":"Имя","it":"Nome","th":"ชื่อ","vi":"Tên","id":"Nama","tr":"Ad","ar":"الاسم"},
    "取消":{"zh-TW":"取消","zh-CN":"取消","en":"Cancel","ja":"キャンセル","ko":"취소","es":"Cancelar","fr":"Annuler","de":"Abbrechen","pt-BR":"Cancelar","ru":"Отмена","it":"Annulla","th":"ยกเลิก","vi":"Hủy","id":"Batal","tr":"İptal","ar":"إلغاء"},
    "儲存":{"zh-TW":"儲存","zh-CN":"保存","en":"Save","ja":"保存","ko":"저장","es":"Guardar","fr":"Enregistrer","de":"Speichern","pt-BR":"Salvar","ru":"Сохранить","it":"Salva","th":"บันทึก","vi":"Lưu","id":"Simpan","tr":"Kaydet","ar":"حفظ"},
    "玩家":{"zh-TW":"玩家","zh-CN":"玩家","en":"Player","ja":"プレイヤー","ko":"플레이어","es":"Jugador","fr":"Joueur","de":"Spieler","pt-BR":"Jogador","ru":"Игрок","it":"Giocatore","th":"ผู้เล่น","vi":"Người chơi","id":"Pemain","tr":"Oyuncu","ar":"اللاعب"},
    "連線中…":{"zh-TW":"連線中…","zh-CN":"连接中…","en":"Connecting…","ja":"接続中…","ko":"연결 중…","es":"Conectando…","fr":"Connexion…","de":"Verbinden…","pt-BR":"Conectando…","ru":"Подключение…","it":"Connessione…","th":"กำลังเชื่อมต่อ…","vi":"Đang kết nối…","id":"Menghubungkan…","tr":"Bağlanıyor…","ar":"جارٍ الاتصال…"},
    "已連線":{"zh-TW":"已連線","zh-CN":"已连接","en":"Connected","ja":"接続済み","ko":"연결됨","es":"Conectado","fr":"Connecté","de":"Verbunden","pt-BR":"Conectado","ru":"Подключено","it":"Connesso","th":"เชื่อมต่อแล้ว","vi":"Đã kết nối","id":"Terhubung","tr":"Bağlandı","ar":"متصل"},
    "未登入":{"zh-TW":"未登入","zh-CN":"未登录","en":"Not signed in","ja":"未ログイン","ko":"로그인하지 않음","es":"No has iniciado sesión","fr":"Non connecté","de":"Nicht angemeldet","pt-BR":"Não conectado","ru":"Не выполнен вход","it":"Non connesso","th":"ยังไม่ได้เข้าสู่ระบบ","vi":"Chưa đăng nhập","id":"Belum masuk","tr":"Giriş yapılmadı","ar":"غير مسجل الدخول"},
    "未命名影片":{"zh-TW":"未命名影片","zh-CN":"未命名视频","en":"Untitled video","ja":"無題の動画","ko":"제목 없는 영상","es":"Vídeo sin título","fr":"Vidéo sans titre","de":"Unbenanntes Video","pt-BR":"Vídeo sem título","ru":"Видео без названия","it":"Video senza titolo","th":"วิดีโอไม่มีชื่อ","vi":"Video chưa đặt tên","id":"Video tanpa judul","tr":"Adsız video","ar":"فيديو بلا عنوان"},
    "Google 登入成功":{"zh-TW":"Google 登入成功","zh-CN":"Google 登录成功","en":"Google sign-in successful","ja":"Google ログイン成功","ko":"Google 로그인 성공","es":"Inicio de sesión de Google correcto","fr":"Connexion Google réussie","de":"Google-Anmeldung erfolgreich","pt-BR":"Login do Google concluído","ru":"Вход через Google выполнен","it":"Accesso Google riuscito","th":"เข้าสู่ระบบ Google สำเร็จ","vi":"Đăng nhập Google thành công","id":"Login Google berhasil","tr":"Google girişi başarılı","ar":"تم تسجيل الدخول عبر Google"},
    "Google 登入失敗":{"zh-TW":"Google 登入失敗","zh-CN":"Google 登录失败","en":"Google sign-in failed","ja":"Google ログインに失敗しました","ko":"Google 로그인 실패","es":"Error al iniciar sesión con Google","fr":"Échec de la connexion Google","de":"Google-Anmeldung fehlgeschlagen","pt-BR":"Falha no login do Google","ru":"Не удалось войти через Google","it":"Accesso Google non riuscito","th":"เข้าสู่ระบบ Google ไม่สำเร็จ","vi":"Đăng nhập Google thất bại","id":"Login Google gagal","tr":"Google girişi başarısız","ar":"فشل تسجيل الدخول عبر Google"},
    "你已被房主移出房間":{"zh-TW":"你已被房主移出房間","zh-CN":"你已被房主移出房间","en":"The room owner removed you from the room","ja":"ルームオーナーによって退出させられました","ko":"방장이 당신을 방에서 내보냈습니다","es":"El anfitrión te expulsó de la sala","fr":"Le propriétaire vous a retiré de la salle","de":"Der Raumhost hat dich aus dem Raum entfernt","pt-BR":"O dono da sala removeu você da sala","ru":"Владелец комнаты удалил вас из комнаты","it":"Il proprietario ti ha rimosso dalla stanza","th":"เจ้าของห้องนำคุณออกจากห้องแล้ว","vi":"Chủ phòng đã xóa bạn khỏi phòng","id":"Pemilik ruang mengeluarkanmu dari ruang","tr":"Oda sahibi seni odadan çıkardı","ar":"أخرجك مالك الغرفة من الغرفة"},
    "目前不在房間內":{"zh-TW":"目前不在房間內","zh-CN":"目前不在房间内","en":"You are not in a room","ja":"現在ルームに参加していません","ko":"현재 방에 없습니다","es":"No estás en una sala","fr":"Vous n’êtes pas dans une salle","de":"Du bist in keinem Raum","pt-BR":"Você não está em uma sala","ru":"Вы не находитесь в комнате","it":"Non sei in una stanza","th":"คุณไม่ได้อยู่ในห้อง","vi":"Bạn không ở trong phòng","id":"Kamu tidak berada di ruang","tr":"Şu anda bir odada değilsin","ar":"أنت لست في غرفة"},
    "你已不在這個房間":{"zh-TW":"你已不在這個房間","zh-CN":"你已不在这个房间","en":"You are no longer in this room","ja":"このルームにはもう参加していません","ko":"더 이상 이 방에 없습니다","es":"Ya no estás en esta sala","fr":"Vous n’êtes plus dans cette salle","de":"Du bist nicht mehr in diesem Raum","pt-BR":"Você não está mais nesta sala","ru":"Вы больше не в этой комнате","it":"Non sei più in questa stanza","th":"คุณไม่ได้อยู่ในห้องนี้แล้ว","vi":"Bạn không còn ở phòng này","id":"Kamu tidak lagi berada di ruang ini","tr":"Artık bu odada değilsin","ar":"لم تعد في هذه الغرفة"},
    "等待有人選擇影片":{"zh-TW":"等待有人選擇影片","zh-CN":"等待有人选择视频","en":"Waiting for someone to choose a video","ja":"誰かが動画を選ぶのを待っています","ko":"누군가 영상을 선택할 때까지 기다리는 중","es":"Esperando a que alguien elija un vídeo","fr":"En attente du choix d’une vidéo","de":"Warte auf die Auswahl eines Videos","pt-BR":"Aguardando alguém escolher um vídeo","ru":"Ожидание выбора видео","it":"In attesa che qualcuno scelga un video","th":"กำลังรอให้เลือกวิดีโอ","vi":"Đang chờ chọn video","id":"Menunggu seseorang memilih video","tr":"Birinin video seçmesi bekleniyor","ar":"بانتظار اختيار فيديو"},
    "複製失敗":{"zh-TW":"複製失敗","zh-CN":"复制失败","en":"Copy failed","ja":"コピーに失敗しました","ko":"복사 실패","es":"Error al copiar","fr":"Échec de la copie","de":"Kopieren fehlgeschlagen","pt-BR":"Falha ao copiar","ru":"Не удалось скопировать","it":"Copia non riuscita","th":"คัดลอกไม่สำเร็จ","vi":"Sao chép thất bại","id":"Penyalinan gagal","tr":"Kopyalama başarısız","ar":"فشل النسخ"},
    "房間連結已複製":{"zh-TW":"房間連結已複製","zh-CN":"房间链接已复制","en":"Room link copied","ja":"ルームリンクをコピーしました","ko":"방 링크가 복사되었습니다","es":"Enlace de la sala copiado","fr":"Lien de la salle copié","de":"Raumlink kopiert","pt-BR":"Link da sala copiado","ru":"Ссылка на комнату скопирована","it":"Link della stanza copiato","th":"คัดลอกลิงก์ห้องแล้ว","vi":"Đã sao chép liên kết phòng","id":"Tautan ruang disalin","tr":"Oda bağlantısı kopyalandı","ar":"تم نسخ رابط الغرفة"},
    "設定":{"zh-TW":"設定","zh-CN":"设置","en":"Settings","ja":"設定","ko":"설정","es":"Ajustes","fr":"Paramètres","de":"Einstellungen","pt-BR":"Configurações","ru":"Настройки","it":"Impostazioni","th":"การตั้งค่า","vi":"Cài đặt","id":"Pengaturan","tr":"Ayarlar","ar":"الإعدادات"},
    "帳號與設定":{"zh-TW":"帳號與設定","zh-CN":"账号与设置","en":"Account & Settings","ja":"アカウントと設定","ko":"계정 및 설정","es":"Cuenta y ajustes","fr":"Compte et paramètres","de":"Konto & Einstellungen","pt-BR":"Conta e configurações","ru":"Аккаунт и настройки","it":"Account e impostazioni","th":"บัญชีและการตั้งค่า","vi":"Tài khoản & cài đặt","id":"Akun & Pengaturan","tr":"Hesap ve ayarlar","ar":"الحساب والإعدادات"},
    "個人資料、主題、通知、收藏與網站工具":{"zh-TW":"個人資料、主題、通知、收藏與網站工具","zh-CN":"个人资料、主题、通知、收藏与网站工具","en":"Profile, themes, notifications, favorites and website tools","ja":"プロフィール、テーマ、通知、お気に入り、サイト機能","ko":"프로필, 테마, 알림, 즐겨찾기 및 사이트 도구","es":"Perfil, temas, notificaciones, favoritos y herramientas","fr":"Profil, thèmes, notifications, favoris et outils du site","de":"Profil, Designs, Benachrichtigungen, Favoriten und Website-Werkzeuge","pt-BR":"Perfil, temas, notificações, favoritos e ferramentas do site","ru":"Профиль, темы, уведомления, избранное и инструменты сайта","it":"Profilo, temi, notifiche, preferiti e strumenti del sito","th":"โปรไฟล์ ธีม การแจ้งเตือน รายการโปรด และเครื่องมือเว็บไซต์","vi":"Hồ sơ, giao diện, thông báo, yêu thích và công cụ trang web","id":"Profil, tema, notifikasi, favorit, dan alat situs","tr":"Profil, temalar, bildirimler, favoriler ve site araçları","ar":"الملف الشخصي والسمات والإشعارات والمفضلة وأدوات الموقع"},
    "個人資料":{"zh-TW":"個人資料","zh-CN":"个人资料","en":"Profile","ja":"プロフィール","ko":"프로필","es":"Perfil","fr":"Profil","de":"Profil","pt-BR":"Perfil","ru":"Профиль","it":"Profilo","th":"โปรไฟล์","vi":"Hồ sơ","id":"Profil","tr":"Profil","ar":"الملف الشخصي"},
    "暱稱":{"zh-TW":"暱稱","zh-CN":"昵称","en":"Nickname","ja":"ニックネーム","ko":"닉네임","es":"Apodo","fr":"Pseudo","de":"Spitzname","pt-BR":"Apelido","ru":"Никнейм","it":"Soprannome","th":"ชื่อเล่น","vi":"Biệt danh","id":"Nama panggilan","tr":"Takma ad","ar":"اللقب"},
    "頭像 Emoji":{"zh-TW":"頭像 Emoji","zh-CN":"头像 Emoji","en":"Avatar Emoji","ja":"アバター絵文字","ko":"아바타 이모지","es":"Emoji del avatar","fr":"Emoji de l’avatar","de":"Avatar-Emoji","pt-BR":"Emoji do avatar","ru":"Эмодзи аватара","it":"Emoji avatar","th":"อีโมจิอวตาร","vi":"Emoji đại diện","id":"Emoji avatar","tr":"Avatar emojisi","ar":"رمز تعبيري للصورة"},
    "儲存個人資料":{"zh-TW":"儲存個人資料","zh-CN":"保存个人资料","en":"Save profile","ja":"プロフィールを保存","ko":"프로필 저장","es":"Guardar perfil","fr":"Enregistrer le profil","de":"Profil speichern","pt-BR":"Salvar perfil","ru":"Сохранить профиль","it":"Salva profilo","th":"บันทึกโปรไฟล์","vi":"Lưu hồ sơ","id":"Simpan profil","tr":"Profili kaydet","ar":"حفظ الملف الشخصي"},
    "複製好友代碼":{"zh-TW":"複製好友代碼","zh-CN":"复制好友代码","en":"Copy friend code","ja":"フレンドコードをコピー","ko":"친구 코드 복사","es":"Copiar código de amigo","fr":"Copier le code ami","de":"Freundecode kopieren","pt-BR":"Copiar código de amigo","ru":"Скопировать код друга","it":"Copia codice amico","th":"คัดลอกรหัสเพื่อน","vi":"Sao chép mã bạn bè","id":"Salin kode teman","tr":"Arkadaş kodunu kopyala","ar":"نسخ رمز الصديق"},
    "通知與網站":{"zh-TW":"通知與網站","zh-CN":"通知与网站","en":"Notifications & Website","ja":"通知とサイト","ko":"알림 및 웹사이트","es":"Notificaciones y sitio web","fr":"Notifications et site","de":"Benachrichtigungen & Website","pt-BR":"Notificações e site","ru":"Уведомления и сайт","it":"Notifiche e sito","th":"การแจ้งเตือนและเว็บไซต์","vi":"Thông báo & trang web","id":"Notifikasi & Situs","tr":"Bildirimler ve site","ar":"الإشعارات والموقع"},
    "顯示好友與私聊通知":{"zh-TW":"顯示好友與私聊通知","zh-CN":"显示好友与私聊通知","en":"Show friend and private chat notifications","ja":"友達とプライベートチャットの通知を表示","ko":"친구 및 개인 채팅 알림 표시","es":"Mostrar notificaciones de amigos y chats privados","fr":"Afficher les notifications d’amis et de discussions privées","de":"Benachrichtigungen für Freunde und private Chats anzeigen","pt-BR":"Mostrar notificações de amigos e chats privados","ru":"Показывать уведомления о друзьях и личных чатах","it":"Mostra notifiche per amici e chat private","th":"แสดงการแจ้งเตือนเพื่อนและแชตส่วนตัว","vi":"Hiển thị thông báo bạn bè và trò chuyện riêng","id":"Tampilkan notifikasi teman dan chat pribadi","tr":"Arkadaş ve özel sohbet bildirimlerini göster","ar":"إظهار إشعارات الأصدقاء والدردشة الخاصة"},
    "允許瀏覽器通知":{"zh-TW":"允許瀏覽器通知","zh-CN":"允许浏览器通知","en":"Allow browser notifications","ja":"ブラウザー通知を許可","ko":"브라우저 알림 허용","es":"Permitir notificaciones del navegador","fr":"Autoriser les notifications du navigateur","de":"Browserbenachrichtigungen erlauben","pt-BR":"Permitir notificações do navegador","ru":"Разрешить уведомления браузера","it":"Consenti notifiche del browser","th":"อนุญาตการแจ้งเตือนเบราว์เซอร์","vi":"Cho phép thông báo trình duyệt","id":"Izinkan notifikasi browser","tr":"Tarayıcı bildirimlerine izin ver","ar":"السماح بإشعارات المتصفح"},
    "安裝 WatchTogether":{"zh-TW":"安裝 WatchTogether","zh-CN":"安装 WatchTogether","en":"Install WatchTogether","ja":"WatchTogether をインストール","ko":"WatchTogether 설치","es":"Instalar WatchTogether","fr":"Installer WatchTogether","de":"WatchTogether installieren","pt-BR":"Instalar WatchTogether","ru":"Установить WatchTogether","it":"Installa WatchTogether","th":"ติดตั้ง WatchTogether","vi":"Cài đặt WatchTogether","id":"Instal WatchTogether","tr":"WatchTogether'ı yükle","ar":"تثبيت WatchTogether"},
    "📡 狀態中心":{"zh-TW":"📡 狀態中心","zh-CN":"📡 状态中心","en":"📡 Status center","ja":"📡 ステータスセンター","ko":"📡 상태 센터","es":"📡 Centro de estado","fr":"📡 Centre d’état","de":"📡 Statuscenter","pt-BR":"📡 Central de status","ru":"📡 Центр состояния","it":"📡 Centro stato","th":"📡 ศูนย์สถานะ","vi":"📡 Trung tâm trạng thái","id":"📡 Pusat status","tr":"📡 Durum merkezi","ar":"📡 مركز الحالة"},
    "🐛 回報問題":{"zh-TW":"🐛 回報問題","zh-CN":"🐛 报告问题","en":"🐛 Report a problem","ja":"🐛 問題を報告","ko":"🐛 문제 신고","es":"🐛 Informar de un problema","fr":"🐛 Signaler un problème","de":"🐛 Problem melden","pt-BR":"🐛 Relatar um problema","ru":"🐛 Сообщить о проблеме","it":"🐛 Segnala un problema","th":"🐛 แจ้งปัญหา","vi":"🐛 Báo cáo sự cố","id":"🐛 Laporkan masalah","tr":"🐛 Sorun bildir","ar":"🐛 الإبلاغ عن مشكلة"},
    "主題":{"zh-TW":"主題","zh-CN":"主题","en":"Theme","ja":"テーマ","ko":"테마","es":"Tema","fr":"Thème","de":"Design","pt-BR":"Tema","ru":"Тема","it":"Tema","th":"ธีม","vi":"Giao diện","id":"Tema","tr":"Tema","ar":"السمة"},
    "收藏影片":{"zh-TW":"收藏影片","zh-CN":"收藏视频","en":"Favorite videos","ja":"お気に入り動画","ko":"즐겨찾기 영상","es":"Vídeos favoritos","fr":"Vidéos favoris","de":"Favorisierte Videos","pt-BR":"Vídeos favoritos","ru":"Избранные видео","it":"Video preferiti","th":"วิดีโอโปรด","vi":"Video yêu thích","id":"Video favorit","tr":"Favori videolar","ar":"الفيديوهات المفضلة"},
    "本機收藏":{"zh-TW":"本機收藏","zh-CN":"本地收藏","en":"Local favorites","ja":"ローカルのお気に入り","ko":"로컬 즐겨찾기","es":"Favoritos locales","fr":"Favoris locaux","de":"Lokale Favoriten","pt-BR":"Favoritos locais","ru":"Локальное избранное","it":"Preferiti locali","th":"รายการโปรดในเครื่อง","vi":"Yêu thích trên thiết bị","id":"Favorit lokal","tr":"Yerel favoriler","ar":"المفضلة المحلية"},
    "隱私說明":{"zh-TW":"隱私說明","zh-CN":"隐私说明","en":"Privacy","ja":"プライバシー","ko":"개인정보 보호","es":"Privacidad","fr":"Confidentialité","de":"Datenschutz","pt-BR":"Privacidade","ru":"Конфиденциальность","it":"Privacy","th":"ความเป็นส่วนตัว","vi":"Quyền riêng tư","id":"Privasi","tr":"Gizlilik","ar":"الخصوصية"},
    "使用規範":{"zh-TW":"使用規範","zh-CN":"使用规范","en":"Usage rules","ja":"利用規約","ko":"사용 규칙","es":"Normas de uso","fr":"Règles d’utilisation","de":"Nutzungsregeln","pt-BR":"Regras de uso","ru":"Правила использования","it":"Regole d'uso","th":"กฎการใช้งาน","vi":"Quy định sử dụng","id":"Aturan penggunaan","tr":"Kullanım kuralları","ar":"قواعد الاستخدام"},
    "房間設定":{"zh-TW":"房間設定","zh-CN":"房间设置","en":"Room settings","ja":"ルーム設定","ko":"방 설정","es":"Ajustes de sala","fr":"Paramètres de la salle","de":"Raumeinstellungen","pt-BR":"Configurações da sala","ru":"Настройки комнаты","it":"Impostazioni stanza","th":"การตั้งค่าห้อง","vi":"Cài đặt phòng","id":"Pengaturan ruang","tr":"Oda ayarları","ar":"إعدادات الغرفة"},
    "儲存成功":{"zh-TW":"儲存成功","zh-CN":"保存成功","en":"Saved successfully","ja":"保存しました","ko":"저장되었습니다","es":"Guardado correctamente","fr":"Enregistré","de":"Erfolgreich gespeichert","pt-BR":"Salvo com sucesso","ru":"Успешно сохранено","it":"Salvato","th":"บันทึกสำเร็จ","vi":"Đã lưu thành công","id":"Berhasil disimpan","tr":"Başarıyla kaydedildi","ar":"تم الحفظ بنجاح"},
    "已取消收藏":{"zh-TW":"已取消收藏","zh-CN":"已取消收藏","en":"Removed from favorites","ja":"お気に入りから削除しました","ko":"즐겨찾기에서 제거됨","es":"Se quitó de favoritos","fr":"Retiré des favoris","de":"Aus Favoriten entfernt","pt-BR":"Removido dos favoritos","ru":"Удалено из избранного","it":"Rimosso dai preferiti","th":"ลบออกจากรายการโปรดแล้ว","vi":"Đã xóa khỏi yêu thích","id":"Dihapus dari favorit","tr":"Favorilerden kaldırıldı","ar":"أُزيل من المفضلة"},
    "已加入收藏":{"zh-TW":"已加入收藏","zh-CN":"已加入收藏","en":"Added to favorites","ja":"お気に入りに追加しました","ko":"즐겨찾기에 추가됨","es":"Añadido a favoritos","fr":"Ajouté aux favoris","de":"Zu Favoriten hinzugefügt","pt-BR":"Adicionado aos favoritos","ru":"Добавлено в избранное","it":"Aggiunto ai preferiti","th":"เพิ่มในรายการโปรดแล้ว","vi":"Đã thêm vào yêu thích","id":"Ditambahkan ke favorit","tr":"Favorilere eklendi","ar":"أُضيف إلى المفضلة"},
    "你已不在這個房間":{"zh-TW":"你已不在這個房間","zh-CN":"你已不在这个房间","en":"You are no longer in this room","ja":"このルームにはもう参加していません","ko":"더 이상 이 방에 없습니다","es":"Ya no estás en esta sala","fr":"Vous n’êtes plus dans cette salle","de":"Du bist nicht mehr in diesem Raum","pt-BR":"Você não está mais nesta sala","ru":"Вы больше не в этой комнате","it":"Non sei più in questa stanza","th":"คุณไม่ได้อยู่ในห้องนี้แล้ว","vi":"Bạn không còn ở phòng này","id":"Kamu tidak lagi berada di ruang ini","tr":"Artık bu odada değilsin","ar":"لم تعد في هذه الغرفة"},
    "Google 登入後才能儲存公開個人資料":{"zh-TW":"Google 登入後才能儲存公開個人資料","zh-CN":"Google 登录后才能保存公开个人资料","en":"Sign in with Google to save your public profile","ja":"公開プロフィールを保存するにはGoogleでログインしてください","ko":"공개 프로필을 저장하려면 Google로 로그인하세요","es":"Inicia sesión con Google para guardar tu perfil público","fr":"Connectez-vous avec Google pour enregistrer votre profil public","de":"Melde dich mit Google an, um dein öffentliches Profil zu speichern","pt-BR":"Entre com o Google para salvar seu perfil público","ru":"Войдите через Google, чтобы сохранить публичный профиль","it":"Accedi con Google per salvare il profilo pubblico","th":"เข้าสู่ระบบ Google เพื่อบันทึกโปรไฟล์สาธารณะ","vi":"Đăng nhập Google để lưu hồ sơ công khai","id":"Masuk dengan Google untuk menyimpan profil publik","tr":"Genel profilini kaydetmek için Google ile giriş yap","ar":"سجّل الدخول باستخدام Google لحفظ ملفك العام"},
    "個人資料已更新":{"zh-TW":"個人資料已更新","zh-CN":"个人资料已更新","en":"Profile updated","ja":"プロフィールを更新しました","ko":"프로필이 업데이트되었습니다","es":"Perfil actualizado","fr":"Profil mis à jour","de":"Profil aktualisiert","pt-BR":"Perfil atualizado","ru":"Профиль обновлён","it":"Profilo aggiornato","th":"อัปเดตโปรไฟล์แล้ว","vi":"Đã cập nhật hồ sơ","id":"Profil diperbarui","tr":"Profil güncellendi","ar":"تم تحديث الملف الشخصي"},
    "好友代碼：":{"zh-TW":"好友代碼：","zh-CN":"好友代码：","en":"Friend code: ","ja":"フレンドコード: ","ko":"친구 코드: ","es":"Código de amigo: ","fr":"Code ami : ","de":"Freundecode: ","pt-BR":"Código de amigo: ","ru":"Код друга: ","it":"Codice amico: ","th":"รหัสเพื่อน: ","vi":"Mã bạn bè: ","id":"Kode teman: ","tr":"Arkadaş kodu: ","ar":"رمز الصديق: "},
    "我的好友代碼：":{"zh-TW":"我的好友代碼：","zh-CN":"我的好友代码：","en":"My friend code: ","ja":"自分のフレンドコード: ","ko":"내 친구 코드: ","es":"Mi código de amigo: ","fr":"Mon code ami : ","de":"Mein Freundecode: ","pt-BR":"Meu código de amigo: ","ru":"Мой код друга: ","it":"Il mio codice amico: ","th":"รหัสเพื่อนของฉัน: ","vi":"Mã bạn bè của tôi: ","id":"Kode teman saya: ","tr":"Arkadaş kodum: ","ar":"رمز صديقي: "},
    "語言":{"zh-TW":"語言","zh-CN":"语言","en":"Language","ja":"言語","ko":"언어","es":"Idioma","fr":"Langue","de":"Sprache","pt-BR":"Idioma","ru":"Язык","it":"Lingua","th":"ภาษา","vi":"Ngôn ngữ","id":"Bahasa","tr":"Dil","ar":"اللغة"},
    "顯示語言":{"zh-TW":"顯示語言","zh-CN":"显示语言","en":"Display language","ja":"表示言語","ko":"표시 언어","es":"Idioma de la interfaz","fr":"Langue d’affichage","de":"Anzeigesprache","pt-BR":"Idioma de exibição","ru":"Язык интерфейса","it":"Lingua di visualizzazione","th":"ภาษาที่แสดง","vi":"Ngôn ngữ hiển thị","id":"Bahasa tampilan","tr":"Görüntüleme dili","ar":"لغة العرض"},
    "首次進入會依瀏覽器語言自動選擇，也可以在這裡手動切換。":{"zh-TW":"首次進入會依瀏覽器語言自動選擇，也可以在這裡手動切換。","zh-CN":"首次进入会根据浏览器语言自动选择，也可以在这里手动切换。","en":"Your browser language is selected on first visit; you can switch it here at any time.","ja":"初回アクセス時はブラウザーの言語が自動選択され、ここでいつでも変更できます。","ko":"첫 방문 시 브라우저 언어가 자동으로 선택되며 여기에서 언제든 변경할 수 있습니다.","es":"En la primera visita se usa el idioma del navegador; puedes cambiarlo aquí cuando quieras.","fr":"Lors de la première visite, la langue du navigateur est utilisée. Vous pouvez la changer ici à tout moment.","de":"Beim ersten Besuch wird die Browsersprache verwendet; hier kannst du sie jederzeit ändern.","pt-BR":"Na primeira visita, o idioma do navegador é usado; você pode alterá-lo aqui a qualquer momento.","ru":"При первом посещении используется язык браузера; здесь его можно изменить в любое время.","it":"Alla prima visita viene usata la lingua del browser; puoi cambiarla qui in qualsiasi momento.","th":"ครั้งแรกจะเลือกภาษาตามเบราว์เซอร์ และคุณสามารถเปลี่ยนได้ที่นี่ทุกเมื่อ","vi":"Lần đầu truy cập sẽ dùng ngôn ngữ của trình duyệt; bạn có thể đổi bất cứ lúc nào tại đây.","id":"Pada kunjungan pertama, bahasa browser digunakan; Anda dapat mengubahnya kapan saja di sini.","tr":"İlk ziyarette tarayıcı dili kullanılır; buradan istediğiniz zaman değiştirebilirsiniz.","ar":"في الزيارة الأولى تُستخدم لغة المتصفح، ويمكنك تغييرها هنا في أي وقت."},
    "自動（瀏覽器語言）":{"zh-TW":"自動（瀏覽器語言）","zh-CN":"自动（浏览器语言）","en":"Automatic (browser language)","ja":"自動（ブラウザーの言語）","ko":"자동(브라우저 언어)","es":"Automático (idioma del navegador)","fr":"Automatique (langue du navigateur)","de":"Automatisch (Browsersprache)","pt-BR":"Automático (idioma do navegador)","ru":"Автоматически (язык браузера)","it":"Automatico (lingua del browser)","th":"อัตโนมัติ (ภาษาของเบราว์เซอร์)","vi":"Tự động (ngôn ngữ trình duyệt)","id":"Otomatis (bahasa browser)","tr":"Otomatik (tarayıcı dili)","ar":"تلقائي (لغة المتصفح)"},
    "播放影片失敗":{"zh-TW":"播放影片失敗","zh-CN":"播放视频失败","en":"Failed to play video","ja":"動画の再生に失敗しました","ko":"영상 재생 실패","es":"No se pudo reproducir el vídeo","fr":"Échec de la lecture de la vidéo","de":"Video konnte nicht abgespielt werden","pt-BR":"Falha ao reproduzir o vídeo","ru":"Не удалось воспроизвести видео","it":"Impossibile riprodurre il video","th":"เล่นวิดีโอไม่สำเร็จ","vi":"Không thể phát video","id":"Gagal memutar video","tr":"Video oynatılamadı","ar":"فشل تشغيل الفيديو"},
    "加入房間失敗":{"zh-TW":"加入房間失敗","zh-CN":"加入房间失败","en":"Failed to join room","ja":"ルームへの参加に失敗しました","ko":"방 참가 실패","es":"No se pudo entrar en la sala","fr":"Échec de l’entrée dans la salle","de":"Beitritt zum Raum fehlgeschlagen","pt-BR":"Falha ao entrar na sala","ru":"Не удалось войти в комнату","it":"Impossibile entrare nella stanza","th":"เข้าร่วมห้องไม่สำเร็จ","vi":"Không thể vào phòng","id":"Gagal masuk ruang","tr":"Odaya katılım başarısız","ar":"فشل الانضمام إلى الغرفة"},
    "建立房間失敗":{"zh-TW":"建立房間失敗","zh-CN":"创建房间失败","en":"Failed to create room","ja":"ルームの作成に失敗しました","ko":"방 생성 실패","es":"No se pudo crear la sala","fr":"Échec de la création de la salle","de":"Raum konnte nicht erstellt werden","pt-BR":"Falha ao criar a sala","ru":"Не удалось создать комнату","it":"Impossibile creare la stanza","th":"สร้างห้องไม่สำเร็จ","vi":"Không thể tạo phòng","id":"Gagal membuat ruang","tr":"Oda oluşturulamadı","ar":"فشل إنشاء الغرفة"},
    "搜尋失敗":{"zh-TW":"搜尋失敗","zh-CN":"搜索失败","en":"Search failed","ja":"検索に失敗しました","ko":"검색 실패","es":"Error de búsqueda","fr":"Échec de la recherche","de":"Suche fehlgeschlagen","pt-BR":"Falha na pesquisa","ru":"Ошибка поиска","it":"Ricerca non riuscita","th":"ค้นหาไม่สำเร็จ","vi":"Tìm kiếm thất bại","id":"Pencarian gagal","tr":"Arama başarısız","ar":"فشل البحث"},
    "播放失敗":{"zh-TW":"播放失敗","zh-CN":"播放失败","en":"Playback failed","ja":"再生に失敗しました","ko":"재생 실패","es":"Error de reproducción","fr":"Échec de la lecture","de":"Wiedergabe fehlgeschlagen","pt-BR":"Falha na reprodução","ru":"Ошибка воспроизведения","it":"Riproduzione non riuscita","th":"เล่นไม่สำเร็จ","vi":"Phát thất bại","id":"Pemutaran gagal","tr":"Oynatma başarısız","ar":"فشل التشغيل"},
    "YouTube 串流重新連線中…":{"zh-TW":"YouTube 串流重新連線中…","zh-CN":"YouTube 流媒体重新连接中…","en":"Reconnecting YouTube stream…","ja":"YouTube ストリームに再接続中…","ko":"YouTube 스트림 재연결 중…","es":"Reconectando la transmisión de YouTube…","fr":"Reconnexion au flux YouTube…","de":"YouTube-Stream wird neu verbunden…","pt-BR":"Reconectando o stream do YouTube…","ru":"Переподключение к потоку YouTube…","it":"Riconnessione allo streaming YouTube…","th":"กำลังเชื่อมต่อสตรีม YouTube ใหม่…","vi":"Đang kết nối lại luồng YouTube…","id":"Menghubungkan ulang streaming YouTube…","tr":"YouTube yayını yeniden bağlanıyor…","ar":"جارٍ إعادة الاتصال ببث YouTube…"},
    "YouTube 串流重新連線失敗":{"zh-TW":"YouTube 串流重新連線失敗","zh-CN":"YouTube 流媒体重新连接失败","en":"YouTube stream reconnection failed","ja":"YouTube ストリームの再接続に失敗しました","ko":"YouTube 스트림 재연결 실패","es":"No se pudo reconectar la transmisión de YouTube","fr":"Échec de la reconnexion au flux YouTube","de":"YouTube-Stream konnte nicht neu verbunden werden","pt-BR":"Falha ao reconectar o stream do YouTube","ru":"Не удалось переподключиться к потоку YouTube","it":"Riconnessione allo streaming YouTube non riuscita","th":"เชื่อมต่อสตรีม YouTube ใหม่ไม่สำเร็จ","vi":"Không thể kết nối lại luồng YouTube","id":"Gagal menghubungkan ulang streaming YouTube","tr":"YouTube yayını yeniden bağlanamadı","ar":"فشل إعادة الاتصال ببث YouTube"},
    "YouTube 串流重新連線逾時":{"zh-TW":"YouTube 串流重新連線逾時","zh-CN":"YouTube 流媒体重新连接超时","en":"YouTube stream reconnection timed out","ja":"YouTube ストリームの再接続がタイムアウトしました","ko":"YouTube 스트림 재연결 시간이 초과되었습니다","es":"Se agotó el tiempo para reconectar la transmisión de YouTube","fr":"Délai de reconnexion au flux YouTube dépassé","de":"Zeitüberschreitung beim erneuten Verbinden des YouTube-Streams","pt-BR":"Tempo limite ao reconectar o stream do YouTube","ru":"Истекло время переподключения к потоку YouTube","it":"Tempo scaduto per la riconnessione allo streaming YouTube","th":"หมดเวลาเชื่อมต่อสตรีม YouTube ใหม่","vi":"Kết nối lại luồng YouTube quá thời gian","id":"Waktu habis saat menghubungkan ulang streaming YouTube","tr":"YouTube yayını yeniden bağlanırken zaman aşımı","ar":"انتهت مهلة إعادة الاتصال ببث YouTube"},
    "YouTube 串流播放錯誤":{"zh-TW":"YouTube 串流播放錯誤","zh-CN":"YouTube 流媒体播放错误","en":"YouTube stream playback error","ja":"YouTube ストリームの再生エラー","ko":"YouTube 스트림 재생 오류","es":"Error de reproducción de la transmisión de YouTube","fr":"Erreur de lecture du flux YouTube","de":"Fehler bei der Wiedergabe des YouTube-Streams","pt-BR":"Erro na reprodução do stream do YouTube","ru":"Ошибка воспроизведения потока YouTube","it":"Errore di riproduzione dello streaming YouTube","th":"เกิดข้อผิดพลาดในการเล่นสตรีม YouTube","vi":"Lỗi phát luồng YouTube","id":"Kesalahan pemutaran streaming YouTube","tr":"YouTube yayını oynatma hatası","ar":"خطأ في تشغيل بث YouTube"},
    "YouTube 串流網址無效":{"zh-TW":"YouTube 串流網址無效","zh-CN":"YouTube 流媒体网址无效","en":"Invalid YouTube stream URL","ja":"YouTube ストリームURLが無効です","ko":"YouTube 스트림 URL이 잘못되었습니다","es":"La URL de transmisión de YouTube no es válida","fr":"URL de flux YouTube invalide","de":"Ungültige YouTube-Stream-URL","pt-BR":"URL do stream do YouTube inválida","ru":"Недействительный URL потока YouTube","it":"URL dello streaming YouTube non valido","th":"URL สตรีม YouTube ไม่ถูกต้อง","vi":"URL luồng YouTube không hợp lệ","id":"URL streaming YouTube tidak valid","tr":"Geçersiz YouTube yayın URL'si","ar":"رابط بث YouTube غير صالح"},
    "YouTube 影片解碼失敗":{"zh-TW":"YouTube 影片解碼失敗","zh-CN":"YouTube 视频解码失败","en":"YouTube video decoding failed","ja":"YouTube 動画のデコードに失敗しました","ko":"YouTube 영상 디코딩 실패","es":"Falló la decodificación del vídeo de YouTube","fr":"Échec du décodage de la vidéo YouTube","de":"YouTube-Video konnte nicht dekodiert werden","pt-BR":"Falha na decodificação do vídeo do YouTube","ru":"Не удалось декодировать видео YouTube","it":"Decodifica del video YouTube non riuscita","th":"ถอดรหัสวิดีโอ YouTube ไม่สำเร็จ","vi":"Giải mã video YouTube thất bại","id":"Dekode video YouTube gagal","tr":"YouTube videosu kodu çözülemedi","ar":"فشل فك ترميز فيديو YouTube"},
    "影片已載入":{"zh-TW":"影片已載入","zh-CN":"视频已加载","en":"Video loaded","ja":"動画を読み込みました","ko":"영상이 로드되었습니다","es":"Vídeo cargado","fr":"Vidéo chargée","de":"Video geladen","pt-BR":"Vídeo carregado","ru":"Видео загружено","it":"Video caricato","th":"โหลดวิดีโอแล้ว","vi":"Đã tải video","id":"Video dimuat","tr":"Video yüklendi","ar":"تم تحميل الفيديو"},
    "YouTube 串流載入中…":{"zh-TW":"YouTube 串流載入中…","zh-CN":"YouTube 流媒体加载中…","en":"Loading YouTube stream…","ja":"YouTube ストリームを読み込み中…","ko":"YouTube 스트림 로드 중…","es":"Cargando la transmisión de YouTube…","fr":"Chargement du flux YouTube…","de":"YouTube-Stream wird geladen…","pt-BR":"Carregando o stream do YouTube…","ru":"Загрузка потока YouTube…","it":"Caricamento dello streaming YouTube…","th":"กำลังโหลดสตรีม YouTube…","vi":"Đang tải luồng YouTube…","id":"Memuat streaming YouTube…","tr":"YouTube yayını yükleniyor…","ar":"جارٍ تحميل بث YouTube…"}
  };

  const LANGUAGES = Object.fromEntries(
    SUPPORTED.map(locale => [
      locale,
      LANGUAGE_NAMES[locale]
    ])
  );

  const sourceByNode = new WeakMap();
  const sourceByAttribute = new WeakMap();
  let currentLocale = DEFAULT_LOCALE;
  let applying = false;

  function normalizeLocale(locale) {
    const value = String(locale || "").trim().replace("_","-");
    if (SUPPORTED.includes(value)) return value;
    const lower = value.toLowerCase();
    if (lower.startsWith("zh-cn") || lower === "zh-sg") return "zh-CN";
    if (lower.startsWith("zh")) return "zh-TW";
    for (const locale of SUPPORTED) {
      if (locale.toLowerCase() === lower) return locale;
    }
    const base = lower.split("-")[0];
    const match = SUPPORTED.find(locale => locale.split("-")[0].toLowerCase() === base);
    return match || null;
  }

  function detectLocale() {
    const list = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language];
    for (const value of list) {
      const normalized = normalizeLocale(value);
      if (SUPPORTED.includes(normalized)) return normalized;
    }
    return DEFAULT_LOCALE;
  }

  function getStoredLocale() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "auto") return "auto";
      if (SUPPORTED.includes(stored)) return stored;
    } catch (_) {}
    return null;
  }

  function resolveInitialLocale() {
    const stored = getStoredLocale();
    return stored && stored !== "auto" ? stored : detectLocale();
  }

  function translate(source, locale = currentLocale) {
    const text = String(source ?? "");
    if (!text.trim()) return text;
    const table = ZH[text.trim()];
    if (table && table[locale]) {
      const leading = text.match(/^\s*/)?.[0] || "";
      const trailing = text.match(/\s*$/)?.[0] || "";
      return leading + table[locale] + trailing;
    }

    let result = text;
    const prefix = ZH["好友代碼："];
    const myPrefix = ZH["我的好友代碼："];

    if (text.trim().startsWith("我的好友代碼：")) {
      result = myPrefix[locale] + text.trim().slice("我的好友代碼：".length).trim();
    } else if (text.trim().startsWith("好友代碼：")) {
      result = prefix[locale] + text.trim().slice("好友代碼：".length).trim();
    }

    return result;
  }

  function translateNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;

    const parent = node.parentElement;
    if (
      !parent ||
      /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/i.test(parent.tagName)
    ) {
      return;
    }

    const current = node.nodeValue || "";
    const previousSource = sourceByNode.get(node);

    if (
      previousSource === undefined ||
      (!applying && current !== translate(previousSource))
    ) {
      sourceByNode.set(node, current);
    }

    const source = sourceByNode.get(node) || current;
    const next = translate(source);

    if (current !== next) {
      node.nodeValue = next;
    }
  }

  function translateElementAttributes(element) {
    if (!(element instanceof Element)) return;
    for (const attr of ["placeholder","title","aria-label","aria-placeholder","alt"]) {
      if (!element.hasAttribute(attr)) continue;
      let attrs = sourceByAttribute.get(element);
      if (!attrs) {
        attrs = {};
        sourceByAttribute.set(element, attrs);
      }
      if (!(attr in attrs)) attrs[attr] = element.getAttribute(attr) || "";
      const next = translate(attrs[attr]);
      if (element.getAttribute(attr) !== next) element.setAttribute(attr, next);
    }
  }

  function translateTree(root = document.body) {
    if (!root) return;

    const roots = [];
    if (root.nodeType === Node.TEXT_NODE) {
      translateNode(root);
      return;
    }

    if (root instanceof Element) {
      roots.push(root);
    }

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT
    );

    let node;
    while ((node = walker.nextNode())) {
      translateNode(node);
    }

    if (root instanceof Element) {
      translateElementAttributes(root);
      root.querySelectorAll?.("*").forEach(translateElementAttributes);
    }

    document.title = translate("WatchTogether｜一起看");
  }

  function setLocale(locale, persist = true) {
    const resolved = locale === "auto" ? detectLocale() : (normalizeLocale(locale) || DEFAULT_LOCALE);
    currentLocale = resolved;
    document.documentElement.lang = resolved;
    document.documentElement.dir = resolved === "ar" ? "rtl" : "ltr";
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, locale === "auto" ? "auto" : resolved); } catch (_) {}
    }
    applying = true;
    try {
      translateTree(document.body);
      const select = document.getElementById("wtLanguageSelect");
      if (select) select.value = getStoredLocale() || "auto";
    } finally {
      applying = false;
    }
    window.dispatchEvent(new CustomEvent("watchtogether:languagechange", {
      detail: { locale: currentLocale, mode: locale === "auto" ? "auto" : "manual" }
    }));
    return currentLocale;
  }

  function getLocale() {
    return currentLocale;
  }

  function getMode() {
    return getStoredLocale() || "auto";
  }

  function buildLanguageOptions(select) {
    if (!select || select.dataset.wtLanguagesReady === "1") return;
    select.innerHTML = "";
    const auto = document.createElement("option");
    auto.value = "auto";
    auto.textContent = "自動（瀏覽器語言）";
    select.appendChild(auto);
    SUPPORTED.forEach(locale => {
      const option = document.createElement("option");
      option.value = locale;
      option.textContent = LANGUAGE_NAMES[locale];
      select.appendChild(option);
    });
    select.dataset.wtLanguagesReady = "1";
    select.value = getMode();
  }

  function init() {
    currentLocale = resolveInitialLocale();
    document.documentElement.lang = currentLocale;
    document.documentElement.dir = currentLocale === "ar" ? "rtl" : "ltr";
    window.addEventListener("DOMContentLoaded", () => {
      translateTree(document.body);
      const settingsSelect = document.getElementById("wtLanguageSelect");
      if (settingsSelect) buildLanguageOptions(settingsSelect);
    });
    const observer = new MutationObserver(mutations => {
      if (applying) return;

      applying = true;
      try {
        for (const mutation of mutations) {
          if (mutation.type === "characterData") {
            translateNode(mutation.target);
            continue;
          }

          if (mutation.type === "attributes" && mutation.target instanceof Element) {
            const attr = mutation.attributeName;
            if (!["placeholder","title","aria-label","aria-placeholder","alt"].includes(attr)) {
              continue;
            }

            let attrs = sourceByAttribute.get(mutation.target);
            if (!attrs) {
              attrs = {};
              sourceByAttribute.set(mutation.target, attrs);
            }

            const current = mutation.target.getAttribute(attr) || "";
            const previousSource = attrs[attr];

            if (
              previousSource === undefined ||
              current !== translate(previousSource)
            ) {
              attrs[attr] = current;
            }

            const next = translate(attrs[attr]);
            if (mutation.target.getAttribute(attr) !== next) {
              mutation.target.setAttribute(attr, next);
            }
            continue;
          }

          if (mutation.type === "childList") {
            mutation.addedNodes.forEach(node => {
              if (node.nodeType === Node.TEXT_NODE) {
                translateNode(node);
              } else if (node.nodeType === Node.ELEMENT_NODE) {
                translateTree(node);
              }
            });
          }
        }
      } finally {
        applying = false;
      }
    });
    window.addEventListener("watchtogether:settings-ready", () => {
      const select = document.getElementById("wtLanguageSelect");
      if (select) buildLanguageOptions(select);
    });
    observer.observe(document.documentElement, {
      subtree:true,
      childList:true,
      characterData:true,
      attributes:true,
      attributeFilter:["placeholder","title","aria-label","aria-placeholder","alt"]
    });
  }

  window.WT_I18N = {
    supported: SUPPORTED.slice(),
    languages: LANGUAGES,
    translate,
    setLocale,
    getLocale,
    getMode,
    detectLocale,
    buildLanguageOptions,
    storageKey: STORAGE_KEY
  };

  init();
})();
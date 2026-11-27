"""Builds ChatLume test fixtures: WhatsApp .txt/.zip and Instagram .zip exports."""
import json, os, random, subprocess, sys, zipfile, shutil

OUT = sys.argv[1]
MEDIA = os.path.join(OUT, "_media")
os.makedirs(MEDIA, exist_ok=True)
random.seed(7)

def ff(*args):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *args], check=True)

def jpeg(path, w, h, hue):
    ff("-f", "lavfi", "-i", f"testsrc2=size={w}x{h}:rate=1,hue=h={hue}", "-frames:v", "1", "-q:v", "4", path)

def opus(path, secs, freq):
    ff("-f", "lavfi", "-i", f"sine=frequency={freq}:duration={secs}", "-c:a", "libopus", "-b:a", "24k", path)

def mp4video(path, secs):
    ff("-f", "lavfi", "-i", f"testsrc2=size=320x240:rate=15:duration={secs}", "-f", "lavfi", "-i", f"sine=frequency=500:duration={secs}",
       "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", path)

def ogg_opus(path, secs, freq):
    ff("-f", "lavfi", "-i", f"sine=frequency={freq}:duration={secs}", "-c:a", "libopus", "-b:a", "24k", "-f", "ogg", path)

def m4a(path, secs, freq):
    ff("-f", "lavfi", "-i", f"sine=frequency={freq}:duration={secs}", "-c:a", "aac", "-b:a", "48k", "-f", "mp4", path)

# ── shared media ─────────────────────────────────────────────────────────────
photos = []
for i in range(14):
    name = f"IMG-202401{(i % 28) + 1:02d}-WA{i:04d}.jpg"
    p = os.path.join(MEDIA, name)
    if not os.path.exists(p):
        w, h = (3000, 2000) if i == 3 else (random.choice([640, 800, 1080]), random.choice([480, 800, 1350]))
        jpeg(p, w, h, i * 25)
    photos.append(name)
voices = []
for i in range(4):
    name = f"PTT-202401{i + 1:02d}-WA{i:04d}.opus"
    p = os.path.join(MEDIA, name)
    if not os.path.exists(p):
        opus(p, 2 + i * 2, 300 + i * 120)
    voices.append(name)
sticker = "STK-20240105-WA0001.png"
if not os.path.exists(os.path.join(MEDIA, sticker)):
    ff("-f", "lavfi", "-i", "testsrc2=size=256x256:rate=1", "-frames:v", "1", os.path.join(MEDIA, sticker))
video = "VID-20240116-WA0001.mp4"
if not os.path.exists(os.path.join(MEDIA, video)):
    mp4video(os.path.join(MEDIA, video), 2)
extra_voice = ["PTT-20240117-WA0010.mp4", "AUD-20240117-WA0011.m4a", "PTT-20240117-WA0012.ogg"]
for i, name in enumerate(extra_voice):
    p = os.path.join(MEDIA, name)
    if not os.path.exists(p):
        (m4a if name.endswith((".mp4", ".m4a")) else ogg_opus)(p, 2 + i, 350 + i * 90)
EVIL_FILE = 'evil"><svg onload=confirm`9`>.pdf'
with open(os.path.join(MEDIA, "Trip plan.pdf"), "wb") as f:
    f.write(b"%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")
with open(os.path.join(MEDIA, "Bob Jones.vcf"), "w") as f:
    f.write("BEGIN:VCARD\nVERSION:3.0\nFN:Bob Jones\nTEL:+15550199\nEND:VCARD\n")

# ── WhatsApp group chat ──────────────────────────────────────────────────────
EVIL = "<img src=x onerror=alert(1)>"
lines = [
    "15/01/2024, 09:00 - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them. Tap to learn more.",
    '15/01/2024, 09:00 - Alice Smith created group "Weekend Hikers"',
    "15/01/2024, 09:01 - Alice Smith added Bob Jones, Carol Diaz and +91 98765 43210",
    f"15/01/2024, 09:01 - Alice Smith added {EVIL}",
    "15/01/2024, 09:02 - Alice Smith: Welcome to Weekend Hikers! Plan: https://example.com/trip?id=42 and https://maps.example.org/route",
    "15/01/2024, 09:03 - Bob Jones: Thanks Alice! Mail me bob.jones@example.com or call +1 (555) 010-0199",
    f"15/01/2024, 09:04 - {EVIL}: \"><script>alert('pwn')</script> <b>bold?</b> javascript:alert(1) https://evil.example.com/\"onmouseover=alert(1)",
    "15/01/2024, 09:05 - Carol Diaz: مرحبا بالجميع 👋 this is RTL mixed text שלום",
    "15/01/2024, 09:06 - +91 98765 43210: hi all, my other number is 98765 43210 😀😀🎉🎉👍🏽👨‍👩‍👧‍👦🇮🇳",
    "15/01/2024, 09:07 - Bob Jones: " + ("This is a very long message. " * 80).strip(),
    "15/01/2024, 09:08 - Dave Lee joined using this group's invite link",
    "15/01/2024, 09:09 - Dave Lee: hey @Alice Smith and @919876543210 — see www.example.net (no scheme) and https://example.com/a_(b)",
    "16/01/2024, 18:00 - Your security code with Eve Adams changed. Tap to learn more.",
]
media_lines = []
for i, ph in enumerate(photos):
    who = ["Alice Smith", "Bob Jones", "Carol Diaz", "Dave Lee"][i % 4]
    media_lines.append(f"16/01/2024, 18:{10 + i:02d} - {who}: {ph} (file attached)")
for i, v in enumerate(voices):
    who = ["Bob Jones", "Alice Smith"][i % 2]
    media_lines.append(f"17/01/2024, 08:{10 + i:02d} - {who}: {v} (file attached)")
media_lines += [
    f"17/01/2024, 09:00 - Carol Diaz: {sticker} (file attached)",
    "17/01/2024, 09:01 - Alice Smith: Trip plan.pdf (file attached)",
    "17/01/2024, 09:02 - Bob Jones: Bob Jones.vcf (file attached)",
    "17/01/2024, 09:03 - Alice Smith: IMG-20240199-WA9999.jpg (file attached)",
    "17/01/2024, 09:04 - Dave Lee: https://example.com/last-link",
    f"17/01/2024, 09:06 - Carol Diaz: {video} (file attached)",
    f"17/01/2024, 09:07 - Bob Jones: {extra_voice[0]} (file attached)",
    f"17/01/2024, 09:08 - Alice Smith: {extra_voice[1]} (file attached)",
    f"17/01/2024, 09:09 - Carol Diaz: {extra_voice[2]} (file attached)",
    f"17/01/2024, 09:10 - محمد علي: {photos[5]} (file attached)",
    "17/01/2024, 09:11 - שרה כהן: שלום https://example.org/he?q=1 مرحبا",
    f"17/01/2024, 09:12 - Dave Lee: {EVIL_FILE} (file attached)",
    "17/01/2024, 09:05 - Dave Lee left",
]
chat = "\n".join(lines + media_lines) + "\n"
with open(os.path.join(OUT, "WhatsApp Chat with Weekend Hikers.txt"), "w") as f:
    f.write("\n".join(lines + [l.split(": ", 1)[0] + ": <Media omitted>" if "(file attached)" in l else l for l in media_lines]) + "\n")
with zipfile.ZipFile(os.path.join(OUT, "WhatsApp Chat with Weekend Hikers.zip"), "w") as z:
    z.writestr("_chat.txt", chat)
    for name in photos[:-0 or None] + voices + [sticker, "Trip plan.pdf", "Bob Jones.vcf", video] + extra_voice:
        z.write(os.path.join(MEDIA, name), name)
    z.writestr(EVIL_FILE, b"%PDF-1.1\n%%EOF\n")

# Names inside URLs (Anonymize must mask the visible text, never the href).
with zipfile.ZipFile(os.path.join(OUT, "WhatsApp Chat with Link Names.zip"), "w") as z:
    z.writestr("_chat.txt", "\n".join([
        "20/02/2024, 10:00 - Alice Smith: profile https://example.com/u/Alice%20Smith/919876543210 ok",
        "20/02/2024, 10:01 - Bob Jones: and https://example.com/people/Bob_Jones?ref=bob.jones@example.com",
        "20/02/2024, 10:02 - Alice Smith: thanks Bob",
    ]) + "\n")

# single / empty
with open(os.path.join(OUT, "WhatsApp Chat with Solo.txt"), "w") as f:
    f.write("01/01/2024, 10:00 - Solo Person: just one message\n")
open(os.path.join(OUT, "WhatsApp Chat with Empty.txt"), "w").close()

# huge: 60k messages, 30 participants
people = [f"{fn} {ln}" for fn, ln in zip(["Anna","Ben","Cleo","Dan","Ela","Finn","Gia","Hugo","Ivy","Jai","Kai","Lea","Max","Nia","Oto","Pia","Quin","Rae","Sol","Tia","Uma","Vic","Wes","Xia","Yan","Zoe","Ari","Bo","Cy","Di"], ["Kim","Ng","Roy","Li","Wu","Ota","Ito","Abe","Sato","Mori"] * 3)]
with open(os.path.join(OUT, "WhatsApp Chat with Huge Group.txt"), "w") as f:
    f.write('01/01/2020, 00:00 - Anna Kim created group "Huge Group"\n')
    for i in range(60000):
        day = 1 + (i // 2000) % 28
        mon = 1 + (i // 56000) % 12
        who = people[i % 30]
        r = i % 50
        body = (f"link {i} https://example.com/p/{i}" if r == 0 else "<Media omitted>" if r == 1 else
                f"hey {people[(i + 3) % 30].split()[0]}, msg {i} 😀 call 555-01{i % 100:02d}" if r == 2 else f"message number {i} lorem ipsum dolor")
        f.write(f"{day:02d}/{mon:02d}/2020, {i % 24:02d}:{i % 60:02d} - {who}: {body}\n")

# ── Instagram ────────────────────────────────────────────────────────────────
def mangle(s):
    return s.encode("utf-8").decode("latin-1")

def ig_msg(sender, ts, content=None, **extra):
    m = {"sender_name": mangle(sender), "timestamp_ms": ts}
    if content is not None:
        m["content"] = mangle(content)
    m.update(extra)
    return m

def react(emoji, actor):
    return {"reaction": mangle(emoji), "actor": mangle(actor), "timestamp": 1700000000}

base = "your_instagram_activity/messages/inbox"
t0 = 1700000000000
dm = []
for i in range(8):
    dm.append(ig_msg("Bob Jones" if i % 2 else "Zoë Ångström", t0 + i * 60000, f"message {i} with café ❤️ and José",
                     **({"reactions": [react("❤", "Bob Jones"), react("😂", "Zoë Ångström"), react("❤️", "Zoë Ångström")]} if i == 2 else {})))
dm.append(ig_msg("Bob Jones", t0 + 9 * 60000, None, photos=[{"uri": f"{base}/bobjones_123456789/photos/{i}.jpg", "creation_timestamp": 1} for i in range(6)],
                 reactions=[react(e, a) for e, a in [("😍", "Zoë Ångström"), ("🔥", "Bob Jones"), ("😮", "Zoë Ångström"), ("😢", "Bob Jones"), ("😡", "Zoë Ångström"), ("👍", "Bob Jones"), ("👍", "Zoë Ångström"), ("🙏🏽", "Zoë Ångström")]]))
dm.append(ig_msg("Zoë Ångström", t0 + 10 * 60000, None, audio_files=[{"uri": f"{base}/bobjones_123456789/audio/{i}.mp4"} for i in range(2)]))
dm.append(ig_msg("Bob Jones", t0 + 11 * 60000, "check this", share={"link": "https://www.instagram.com/p/ABC123/", "share_text": mangle("Zoë's trip ✈️"), "original_content_owner": mangle("zoe.angstrom")}))
dm.append(ig_msg("Zoë Ångström", t0 + 11 * 60000 + 1000, None, share={"link": "https://www.instagram.com/reel/REEL42/?igsh=abc", "share_text": mangle("Best café in town ☕ <script>alert(5)</script>"), "original_content_owner": mangle("bobjones_travels")}))
dm.append(ig_msg("Bob Jones", t0 + 11 * 60000 + 2000, None, videos=[{"uri": f"{base}/bobjones_123456789/videos/clip.mp4"}]))
dm.append(ig_msg("Bob Jones", t0 + 11 * 60000 + 3000, None, files=[{"uri": f"{base}/bobjones_123456789/files/itinerary.pdf"}]))
dm.append(ig_msg("Zoë Ångström", t0 + 12 * 60000, "<script>alert('x')</script> <img src=x onerror=alert(2)> https://example.com/x?y=1&z=2",
                 reactions=[{"reaction": mangle("😂"), "actor": mangle("<b onmouseover=alert(3)>Mallory</b>")}]))
dm.append({"sender_name": mangle("Bob Jones"), "timestamp_ms": t0 + 13 * 60000, "content": "no reactions field"})
dm.append({"sender_name": None, "timestamp_ms": "garbage", "content": "missing sender and bad ts", "reactions": [None, {"reaction": None, "actor": "x"}, {"actor": "Nobody"}]})
dm.append({"timestamp_ms": t0 + 14 * 60000})  # empty message, skipped
dm.append(ig_msg("Bob Jones", t0 + 15 * 60000, "photo that is missing", photos=[{"uri": f"{base}/bobjones_123456789/photos/missing.jpg"}]))
dm.append(ig_msg("Bob Jones", t0 + 16 * 60000, "unsent", is_unsent=True))
# Reactions (Phase 3). Times are seconds, as in real exports.
crowd = ["Ann Lee", "Raj Patel", "Kim Ode", "Lena Fox", "Omar Haddad", "Mei Chen", "Ivan Petrov", "Sara Cohen", "Tomás Ruiz", "Yuki Sato", "Nia Brown", "Ola Berg"]
many = ["😀", "😂", "😍", "🔥", "😮", "😢", "😡", "👍", "🙏🏽", "🎉", "💯", "👏"]
dm.append(ig_msg("Zoë Ångström", t0 + 17 * 60000, "many reactions here",
                 reactions=[react(e, a) for e, a in zip(many, crowd)]))
dm.append(ig_msg("Bob Jones", t0 + 18 * 60000, "reaction edge cases",
                 reactions=[
                     {"reaction": mangle("<img src=x onerror=alert(7)>"), "actor": mangle("Zoë Ångström"), "timestamp": 1700000001},
                     {"reaction": mangle("😂"), "actor": mangle('"><svg onload=alert(8)>'), "timestamp": 1700000001},
                     {"reaction": mangle("😂"), "timestamp": 1700000001},
                     {"reaction": 42, "actor": mangle("Number Field"), "timestamp": 1700000001},
                     {"reaction": mangle("👍"), "actor": mangle("Bob Jones"), "timestamp": 1700000001},
                     {"reaction": mangle("👍"), "actor": mangle("Bob Jones"), "timestamp": 1700000002},
                 ]))
dm.append(ig_msg("Zoë Ångström", t0 + 19 * 60000, "my own message, reacted to",
                 reactions=[react("❤", "Bob Jones"), react("❤️", "Zoë Ångström")]))
dm_json = {"participants": [{"name": mangle("Bob Jones")}, {"name": mangle("Zoë Ångström")}], "messages": list(reversed(dm)), "title": mangle("Bob Jones"), "is_still_participant": True, "thread_path": "inbox/bobjones_123456789"}

grp = [ig_msg(["Ann Lee", "Raj Patel", "Kim Ode", "Zoë Ångström"][i % 4], t0 + i * 1000, f"group msg {i} hi Raj, ping Kim", **({"reactions": [react("👍", n) for n in ["Ann Lee", "Raj Patel", "Kim Ode", "Ghost Member"]]} if i % 5 == 0 else {})) for i in range(40)]
grp_json = {"participants": [{"name": mangle(n)} for n in ["Ann Lee", "Raj Patel", "Kim Ode", "Zoë Ångström"]], "messages": list(reversed(grp)), "title": mangle("Ann, Raj, Kim")}

with zipfile.ZipFile(os.path.join(OUT, "instagram-test.zip"), "w") as z:
    z.writestr(f"{base}/bobjones_123456789/message_1.json", json.dumps(dm_json))
    for i in range(6):
        z.write(os.path.join(MEDIA, photos[i]), f"{base}/bobjones_123456789/photos/{i}.jpg")
    for i in range(2):
        p = os.path.join(MEDIA, f"ig-voice-{i}.mp4")
        if not os.path.exists(p):
            m4a(p, 3 + i, 440 + i * 200)
        z.write(p, f"{base}/bobjones_123456789/audio/{i}.mp4")
    z.write(os.path.join(MEDIA, video), f"{base}/bobjones_123456789/videos/clip.mp4")
    z.writestr(f"{base}/bobjones_123456789/files/itinerary.pdf", b"%PDF-1.1\n%%EOF\n")
    z.writestr(f"{base}/annrajkim_987654321/message_1.json", json.dumps(grp_json))
    z.writestr(f"{base}/broken_111111111/message_1.json", json.dumps(dm_json)[:300])
    z.writestr(f"{base}/emptythread_222222222/message_1.json", json.dumps({"participants": [], "messages": []}))
    z.writestr("your_instagram_activity/messages/message_requests/stranger_333333333/message_1.json", json.dumps({"participants": [{"name": "Stranger Danger"}], "messages": [ig_msg("Stranger Danger", t0, "hello?")], "title": "Stranger Danger"}))

with zipfile.ZipFile(os.path.join(OUT, "instagram-big.zip"), "w") as z:
    for i in range(6):
        z.write(os.path.join(MEDIA, photos[i]), f"{base}/bigthread_555555555/photos/{i}.jpg")
    big = []
    for i in range(50000):
        extra = {"photos": [{"uri": f"{base}/bigthread_555555555/photos/{i % 6}.jpg"}]} if i % 10 == 0 else {}
        if i % 25 == 0:
            extra["share"] = {"link": f"https://www.instagram.com/reel/R{i}/", "share_text": f"reel {i}", "original_content_owner": "creator"}
        if i % 7 == 0:
            extra["reactions"] = [react("❤", "Big One"), react("❤️" if i % 2 else "😂", "Big Two")]
        big.append(ig_msg(["Big One", "Big Two"][i % 2], t0 + i * 30000, f"big msg {i}", **extra))
    z.writestr(f"{base}/bigthread_555555555/message_1.json", json.dumps({"participants": [{"name": "Big One"}, {"name": "Big Two"}], "messages": list(reversed(big)), "title": "Big Thread"}))

for f in sorted(os.listdir(OUT)):
    p = os.path.join(OUT, f)
    if os.path.isfile(p):
        print(f, os.path.getsize(p))

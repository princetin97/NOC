# Huong dan trien khai cho cac site khac

Tai lieu nay mo ta quy trinh trien khai he thong tu source moi nhat tren GitHub cho site moi va site da co san.

## 1. Pham vi

- He dieu hanh muc tieu: Ubuntu 24.04
- Kieu trien khai: Docker Compose
- Thu muc khuyen nghi tren server site: /root/NOC

## 2. Chuan bi truoc khi deploy

1. Dam bao server co the truy cap GitHub (SSH hoac HTTPS).
2. Mo firewall toi thieu:
- 8080/tcp cho UI
- 4000/tcp neu can goi API truc tiep tu xa
- 162/udp cho SNMP Trap
3. Neu chua co Docker, dung script setup:

```bash
cd /root
git clone https://github.com/princetin97/NOC.git
cd /root/NOC
chmod +x deploy/setup-ubuntu-24.04.sh
chmod +x deploy/quick-deploy-site.sh
```

## 3. Trien khai nhanh cho site moi (khuyen nghi)

Tu server site:

```bash
cd /root/NOC
chmod +x deploy/quick-deploy-site.sh
./deploy/quick-deploy-site.sh \
  --repo https://github.com/princetin97/NOC.git \
  --branch main \
  --dir /root/NOC \
  --site-name site-a \
  --public-host <IP-hoac-domain-cua-site>
```

Script se tu dong:
1. Cap nhat source.
2. Tao/cap nhat file .env.
3. Sinh AUTH_BOOTSTRAP_TOKEN neu chua co.
4. Build va start toan bo stack.

## 4. Tao admin dau tien (bat buoc cho site moi)

Neu trang dang nhap bao loi "No users exist yet", can bootstrap admin dau tien:

```bash
cd /root/NOC
BOOTSTRAP_TOKEN="$(grep '^AUTH_BOOTSTRAP_TOKEN=' .env | cut -d= -f2-)"

curl -sS -X POST 'http://127.0.0.1:4000/api/auth/bootstrap' \
  -H 'Content-Type: application/json' \
  -d "$(cat <<EOF
{"token":"$BOOTSTRAP_TOKEN","username":"admin","password":"YourStrongPass123!"}
EOF
)"
```

Luu y:
- Endpoint bootstrap chi dung duoc khi chua co user nao trong he thong.
- Neu da co user, API se tra 409 va khong tao them admin theo luong bootstrap.

## 5. Cap nhat site da chay len source moi nhat

Khi da co he thong dang chay va chi can cap nhat source moi:

```bash
cd /root/NOC
git fetch --all --prune
git checkout main
git pull --ff-only origin main
docker compose up -d --build --remove-orphans
docker compose ps
```

## 6. Kiem tra sau deploy

```bash
cd /root/NOC
curl -fsS http://127.0.0.1:4000/api/health
docker compose ps
docker compose logs --tail 100 api
docker compose logs --tail 100 poller
docker compose logs --tail 100 trap-collector
```

Ky vong:
- API health tra ve thanh cong.
- Cac service chinh Up/Healthy: api, poller, trap-collector, postgres, redis, ui.

## 7. Su co thuong gap va cach xu ly nhanh

### 7.1 Loi "No users exist yet"

Nguyen nhan:
- Chua bootstrap admin dau tien.

Cach xu ly:
- Chay lai buoc o muc 4.

### 7.2 Curl bi treo voi dau nhac ">"

Nguyen nhan:
- Loi dau nhay trong JSON payload.

Cach xu ly:
- Nhan Ctrl + C de huy lenh dang treo.
- Dung dung cau truc heredoc o muc 4 (khong tu escape dau nhay).

### 7.3 Loi pull/push do xac thuc GitHub

Voi HTTPS:
- Username la tai khoan GitHub.
- Password phai dung Personal Access Token (PAT), khong dung mat khau web.

## 8. Lenh van hanh nhanh

```bash
cd /root/NOC
docker compose ps
docker compose logs -f api
docker compose logs -f poller
docker compose logs -f trap-collector
docker compose restart api poller trap-collector
```

## 9. Khuyen nghi bao mat

1. Doi mat khau admin ngay sau bootstrap thanh cong.
2. Luu AUTH_BOOTSTRAP_TOKEN an toan, khong chia se qua kenh cong khai.
3. Dat JWT_SECRET manh va duy nhat cho tung site.
4. Gioi han truy cap cong 4000 neu khong can expose API ra Internet.

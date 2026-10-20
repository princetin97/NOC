# Huong dan cap nhat source len GitHub va redeploy cac site

Tai lieu nay gom 2 phan:
- Phan A: Lenh day source moi nhat len GitHub.
- Phan B: Lenh tai cac site de cap nhat source moi nhat va build lai.

## A) Day source moi nhat len GitHub (tu may trung tam)

Di chuyen vao thu muc source:

```bash
cd /network-monitor
```

Kiem tra thay doi:

```bash
git status
```

Them file thay doi va commit:

```bash
git add .
git commit -m "chore: update source and deployment docs"
```

Day len nhanh main:

```bash
git push -u origin main
```

Neu can gan phien ban (khuyen nghi cho ban phat hanh):

```bash
chmod +x deploy/version-tag.sh
./deploy/version-tag.sh v0.8.45 "release: mo ta thay doi"
./deploy/version-tag.sh v0.8.45 "release: mo ta thay doi" --push
```

Kiem tra commit va tag tren remote:

```bash
git ls-remote --heads origin main
git ls-remote --tags origin v0.8.44
```

Luu y xac thuc HTTPS:
- Username: tai khoan GitHub.
- Password: dung Personal Access Token (PAT), khong dung mat khau dang nhap web.

Luu y quan trong ve "ghi nho du an":
- Sau moi thay doi code co y nghia, cap nhat them:
  - `CHANGELOG.md` (lich su thay doi)
  - `docs/PROJECT-MEMORY.md` (tom tat context nhanh khi mo lai source)

## B) Cap nhat source moi nhat va build lai tren cac site

### B1. Cach nhanh cho moi site (1 may)

```bash
cd /root/NOC
git fetch --all --prune
git checkout main
git pull --ff-only origin main
docker compose up -d --build --remove-orphans
docker compose ps
```

Kiem tra health nhanh:

```bash
curl -fsS http://127.0.0.1:4000/api/health
docker compose logs --tail 100 api
docker compose logs --tail 100 poller
docker compose logs --tail 100 trap-collector
```

### B2. Neu update theo tag cu the

Vi du deploy dung tag v0.8.44:

```bash
cd /root/NOC
git fetch --all --tags --prune
git checkout v0.8.44
docker compose up -d --build --remove-orphans
docker compose ps
```

Neu muon quay lai nhanh main:

```bash
cd /root/NOC
git checkout main
git pull --ff-only origin main
docker compose up -d --build --remove-orphans
```

## C) Mau quy trinh van hanh de tranh lech phien ban giua cac site

1. Tren may trung tam:
- Commit
- Push main
- Tao tag phien ban
- Push tag

2. Tren tung site:
- Pull main (hoac checkout tag)
- Build lai bang docker compose
- Kiem tra health

3. Xac nhan:
- UI vao duoc
- API health OK
- Poller/trap-collector khong bao loi trong log

## D) Xu ly loi thuong gap

### D1. git pull bi conflict

```bash
cd /root/NOC
git status
```

Neu can GIU thay doi local tam thoi (de pull truoc):

```bash
cd /root/NOC
git stash push -m "site-local-before-pull"
git pull --ff-only origin main
docker compose up -d --build --remove-orphans
```

Neu chi bi 1 file va muon bo file do de nhan source moi nhat:

```bash
cd /root/NOC
git checkout -- backend/src/poller/metrics.ts
git pull --ff-only origin main
docker compose up -d --build --remove-orphans
```

Neu site khong duoc phep sua source local, dung cach reset toan bo:

```bash
git reset --hard origin/main
docker compose up -d --build --remove-orphans
```

Chi dung lenh nay khi chac chan khong can giu thay doi local.

### D2. docker build loi mang npm ECONNRESET

Thu lai build:

```bash
cd /root/NOC
docker compose up -d --build
```

Neu van loi, kiem tra DNS/proxy outbound cua site.

### D3. Dang nhap bao No users exist yet

Site moi chua co admin dau tien, can bootstrap:

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

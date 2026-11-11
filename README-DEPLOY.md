# 上线到 GitHub Pages（四步）

## 1. 建仓库
GitHub 新建 public 仓库，名字随意（建议 `aster-site`），勾 Add a README。

## 2. 传文件
把这个文件夹里**所有文件**拖进仓库根目录（网页上拖拽即可），保持结构：

```
index.html          # 首页
docs.html           # 说明页
config.js           # 唯一需要改的文件
app/                # 手机网页版
CNAME               # 自定义域名（没买域名就先删掉）
404.html
robots.txt
.nojekyll
```

## 3. 改 config.js
```js
window.ASTER = {
  repo: '你的用户名/aster-site',
  site: 'https://你的域名 或 https://用户名.github.io/aster-site',
  email: 'hello@asteragent.com',
  version: '3.8.3',
};
```

## 4. 开 Pages
Settings → Pages → Source: `main` / `/ (root)` → Save。
一分钟左右，`https://用户名.github.io/aster-site/` 就能打开。

装包放 Releases：Releases → Draft a new release → tag `v3.8.3` → 上传 `.pkg`。

## 绑域名（可选）
1. 域名商后台加 CNAME：`asteragent.com` → `用户名.github.io`
2. 仓库 Settings → Pages → Custom domain 填 `asteragent.com`
3. 勾 Enforce HTTPS

CNAME 文件里已经是 `asteragent.com`；换域名就改这个文件。

Aster 手机版（PWA）

怎么用
1. 把这三件事配好：Base URL、模型名、API Key（设置页里填）
2. 填完点「测试」，通了就能说话
3. 记忆存在这台手机上，不上传

怎么放到手机上
· 最快：把这个文件夹丢到你自己的网站 / NAS 的网页目录，用手机浏览器打开，然后「添加到主屏幕」
· 也可以：手机浏览器直接打开本地的 index.html（能跑，但存储走简易模式）

和电脑互通
· 手机「设置 → 导出」得到一个 aster-memory-日期.json
· 电脑：设置里没用；用接口或命令行导入：
    curl -X POST http://127.0.0.1:<端口>/memory/import_json \
      -H 'Content-Type: application/json' -d @aster-memory-2026-11-10.json
  或把文件发给桌面端，让桌面端导入

注意
· 手机上不跑模型，全部走你配的那家 API
· 记忆只存文字，一条 100–200 字节；一万条约 2MB

"""把插件目录打包成 dist/dsh-glass-shell-<version>.zip。

仓库根目录就是插件目录（通过 link 装进 DSH profile，改完文件刷新页面即生效）。
要搬到别的机器时再跑这个脚本生成 zip，避免仓库里留一份过期的压缩包。

zip 里固定包一层 `glass-shell/`，解压出来就是一个可以直接安装的插件目录。

用法：python tools/pack.py
"""
import json
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
SKIP_DIRS = {".git", "node_modules", "dist", "__pycache__"}
SKIP_FILES = {".DS_Store", "Thumbs.db"}

with open(os.path.join(ROOT, "package.json"), encoding="utf-8") as handle:
    version = json.load(handle)["version"]

os.makedirs(DIST, exist_ok=True)
out = os.path.join(DIST, "dsh-glass-shell-%s.zip" % version)
if os.path.exists(out):
    os.remove(out)

count = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for name in sorted(filenames):
            if name in SKIP_FILES or name.endswith((".zip", ".log", ".tmp")):
                continue
            full = os.path.join(dirpath, name)
            relative = os.path.relpath(full, ROOT).replace("\\", "/")
            archive.write(full, "glass-shell/" + relative)
            count += 1

print("打包完成：%s（%d 个文件，%.1f KB）" % (
    os.path.relpath(out, ROOT), count, os.path.getsize(out) / 1024))

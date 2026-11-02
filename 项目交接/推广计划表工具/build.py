"""把 model.js + ui.js 拼进 page.html，出两份：发布用的和单独打开用的。"""
import os, sys
here = os.path.dirname(os.path.abspath(__file__))
out_pub = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'build', '推广计划表.html')
read = lambda n: open(os.path.join(here, n), encoding='utf-8').read()
page, model, ui = read('page.html'), read('model.js'), read('ui.js')
for s in (model, ui):
    assert '</script' not in s.lower(), 'script 里不能出现结束标签'
lib = '<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>'
html = page.replace('<!--LIBS-->', lib).replace('<!--MODEL-->', model).replace('<!--UI-->', ui)
os.makedirs(os.path.dirname(out_pub), exist_ok=True)
open(out_pub, 'w', encoding='utf-8').write(html)
# 单独打开（双击就能用）：补上文档外壳
alone = ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
         '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
         '<style>[hidden]{display:none!important}body{margin:0}</style></head><body>' + html + '</body></html>')
alone_path = os.path.join(os.path.dirname(out_pub), '推广计划表（可直接打开）.html')
open(alone_path, 'w', encoding='utf-8').write(alone)
print(out_pub, len(html.encode()), 'bytes')
print(alone_path)

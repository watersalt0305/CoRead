// CoRead reader.js Markdown XSS 回归测试：node xss_regression.js
const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync(process.argv[2]||'/workspace/build/repo/dist/ui/reader/reader.js','utf8');
function grab(n){const i=src.indexOf('function '+n+'(');let d=0,j=i,s=false;for(;j<src.length;j++){if(src[j]=='{'){d++;s=true}else if(src[j]=='}'){d--;if(s&&d==0){j++;break}}}return src.slice(i,j)}
const ctx={};vm.createContext(ctx);vm.runInContext(grab('escHtml')+grab('safeUrl')+grab('simpleMarkdown')+';this.md=simpleMarkdown;this.esc=escHtml;',ctx);
const {md,esc}=ctx;let fail=0;
// 属性跳出 = 输出中出现 真引号 + 空白 + 事件属性/危险协议
const BREAKOUT=/"\s+(on\w+|src|href|style)\s*=|(href|src)="\s*(javascript|vbscript|data:text)/i;
function bad(n,o,re){re=re||BREAKOUT;const h=re.test(o);console.log((h?'FAIL':'ok  ')+' '+n);if(h){console.log('     -> '+o.slice(0,200));fail++}}
function good(n,o,re){const h=re.test(o);console.log((h?'ok  ':'FAIL')+' '+n);if(!h){console.log('     -> '+o.slice(0,200));fail++}}
bad('javascript: 链接', md('[x](javascript:alert(1))'));
bad('JAVASCRIPT 大小写+制表符', md('[x](JaVa\tScRiPt:alert(1))'));
bad('实体编码 javascript', md('[x](&#106;avascript:alert(1))'), /href="[^"]*&#106;/i);
bad('img onerror 属性注入', md('![x](x" onerror="alert(1))'));
bad('img 双引号跳出', md('![a](" onerror=alert(1) x=")'));
bad('a 属性注入', md('[x](x" onclick="alert(1))'));
bad('alt 属性注入', md('![" onerror="alert(1)](x.png)'));
bad('data:text/html', md('![x](data:text/html;base64,PHNjcmlwdD4=)'));
bad('data:image/svg', md('![x](data:image/svg+xml;base64,PHN2Zz4=)'), /src="data:image\/svg/i);
bad('vbscript', md('[x](vbscript:msgbox)'));
bad('原始 <script>', md('<script>alert(1)</script>'), /<script/);
bad('<img> 直接写', md('<img src=x onerror=alert(1)>'), /<img src=x/);
bad('代码块 lang 注入', md('```js" onload="alert(1)\nx\n```'));
bad('表格单元格 <svg onload>', md('|a|b|\n|--|--|\n|<svg onload=alert(1)>|c|'), /<svg/);
bad('callout 标题注入', md('> [!note] <img src=x onerror=alert(1)>'), /<img src=x/);
bad('callout type 注入', md('> [!x"onload="alert(1)] t'));
bad('escHtml 引号', esc('" onclick="x'), /" onclick/);
good('http 链接保留', md('[a](https://example.com/p?x=1&y=2)'), /href="https:\/\/example\.com\/p\?x=1&amp;y=2"/);
good('相对路径图片保留', md('![i](images/a.png)'), /src="images\/a\.png"/);
good('data:image/png 保留', md('![i](data:image/png;base64,iVBORw0KGgo=)'), /src="data:image\/png;base64,iVBORw0KGgo="/);
good('mailto 保留', md('[m](mailto:a@b.c)'), /href="mailto:a@b\.c"/);
good('锚点保留', md('[t](#top)'), /href="#top"/);
good('粗体正常', md('**b**'), /<strong>b<\/strong>/);
good('表格正常', md('|a|b|\n|--|--|\n|1|2|'), /<td[^>]*>1<\/td>/);
good('代码块 lang 正常', md('```js\nx\n```'), /class="language-js"/);
good('中文引号不受影响', md('他说“你好”'), /他说“你好”/);
good('英文引号显示', md('say "hi"'), /say &quot;hi&quot;/);
console.log(fail?`\n${fail} FAILED`:'\nALL PASS');process.exit(fail?1:0);

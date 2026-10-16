'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {format} = require('../static/format.js');

test('paragraphs preserve line breaks and leave unsupported syntax readable', () => {
 assert.equal(format('First line\r\nSecond line\r\n\r\n> A quoted idea'),
  '<p class="md-paragraph">First line<br>Second line</p>\n<p class="md-paragraph">&gt; A quoted idea</p>');
 assert.equal(format(null), '');
 assert.match(format('not a table | still a sentence\nNext sentence'), /sentence<br>Next sentence/);
});

test('generated raw HTML and attribute attacks cannot create markup', () => {
 const result = format('<img src=x onerror="alert(1)">\n<script>alert(2)</script>\n**<svg onload=alert(3)>**');
 assert.ok(!/<(?:img|script|svg)\b/i.test(result));
 assert.match(result, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
 assert.match(result, /<strong>&lt;svg onload=alert\(3\)&gt;<\/strong>/);
});

test('unsafe URL schemes and obfuscated or malformed URLs remain text', () => {
 for (const destination of ['javascript:alert', 'data:text/html,bad', 'file:///tmp/a', '//example.com',
  ' https://example.com', 'https://example.com\tbad', 'https://', 'java&#x73;cript:alert']) {
  const result = format('[open](' + destination + ')');
  assert.ok(!result.includes('<a '), destination);
  assert.ok(result.includes('[open]('), destination);
 }
});

test('HTTP(S) links escape attributes and use safe external-link attributes', () => {
 const result = format('[**Source**](https://example.com/path?q="test"&a=1) and [HTTP](http://example.com)');
 assert.match(result, /href="https:\/\/example\.com\/path\?q=%22test%22&amp;a=1"/);
 assert.match(result, /target="_blank" rel="noopener noreferrer"><strong>Source<\/strong><\/a>/);
 assert.match(result, /href="http:\/\/example\.com\/"/);
});

test('inline code does not parse bold, links or HTML inside it', () => {
 const result = format('Run `<b>**draft** [x](https://example.com)</b>` then **review**.');
 assert.match(result, /<code>&lt;b&gt;\*\*draft\*\* \[x\]\(https:\/\/example\.com\)&lt;\/b&gt;<\/code>/);
 assert.equal((result.match(/<strong>/g) || []).length, 1);
 assert.ok(!result.includes('<a '));
});

test('fenced code preserves whitespace, escapes code and does not consume later headings', () => {
 const result = format('```html\n  <script>alert("x")</script>\n\n**literal**\n```\n\n## Next step\nReview it.');
 assert.match(result, /<pre dir="ltr"><code>  &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;\n\n\*\*literal\*\*<\/code><\/pre>/);
 assert.match(result, /<h4>Next step<\/h4>/);
 assert.match(result, /<p class="md-paragraph">Review it\.<\/p>/);
 assert.ok(!result.includes('<script>'));
});

test('an unclosed code fence has a readable, safe fallback', () => {
 const result = format('~~~text\n<script>\n# literal heading');
 assert.match(result, /&lt;script&gt;\n# literal heading/);
 assert.ok(!result.includes('<h'));
});

test('literal heading hashes and unmatched inline delimiters stay visible', () => {
 assert.match(format('# C#\n## A heading ##'), /<h3>C#<\/h3>\n<h4>A heading<\/h4>/);
 assert.equal(format('a ````` unfinished'), '<p class="md-paragraph">a ````` unfinished</p>');
});

test('Persian lists preserve content, order and indented continuation', () => {
 const result = format('# برنامه\n\n- **مخاطب** را مشخص کن\n- محتوا بساز\n  نتیجه را بررسی کن\n\n3. اندازه‌گیری\n4. بهبود');
 assert.match(result, /<h3>برنامه<\/h3>/);
 assert.match(result, /<ul class="md-list"><li><strong>مخاطب<\/strong> را مشخص کن<\/li><li>محتوا بساز<br>نتیجه را بررسی کن<\/li><\/ul>/);
 assert.match(result, /<ol class="md-list" start="3"><li>اندازه‌گیری<\/li><li>بهبود<\/li><\/ol>/);
});

test('Persian pipe tables have semantic headers, alignment and accessible scroll regions', () => {
 const result = format('| معیار | هدف |\n| :--- | ---: |\n| بازدید | **۱۰۰** |\n| تبدیل | `۲٪` |\n\nبعد از جدول');
 assert.match(result, /class="md-table-wrap" role="region" aria-label="Response table" tabindex="0"/);
 assert.match(result, /<th class="md-align-left" scope="col">معیار<\/th>/);
 assert.match(result, /<th class="md-align-right" scope="col">هدف<\/th>/);
 assert.match(result, /<td class="md-align-right"><strong>۱۰۰<\/strong><\/td>/);
 assert.match(result, /<p class="md-paragraph">بعد از جدول<\/p>/);
});

test('table delimiters inside inline code or escaped text remain in their cells', () => {
 const result = format('| Value | Note |\n| --- | :---: |\n| `a|b` | one \\| two |\n## Summary');
 assert.match(result, /<td class="md-align-left"><code>a\|b<\/code><\/td>/);
 assert.match(result, /<td class="md-align-center">one \| two<\/td>/);
 assert.match(result, /<h4>Summary<\/h4>/);
 assert.equal((result.match(/<td /g) || []).length, 2);
});

test('malformed table rows remain visible rather than discarding their contents', () => {
 const result = format('| A | B |\n| --- | --- |\n| 1 | 2 |\n| unmatched | row | extra |\nFinal paragraph');
 assert.match(result, /<p class="md-paragraph">\| unmatched \| row \| extra \|<br>Final paragraph<\/p>/);
});

test('HTML in table cells and malicious language labels remain escaped', () => {
 const result = format('| Header |\n| --- |\n| <img src=x onerror=alert(1)> |\n\n```<img onerror=alert(2)>\ncode\n```');
 assert.ok(!result.includes('<img'));
 assert.match(result, /&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.match(result, /class="md-code-language">&lt;img onerror=alert\(2\)&gt;/);
});

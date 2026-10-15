/* A deliberately small Markdown renderer. Generated content is always escaped. */
(function (root) {
 'use strict';
 const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
 })[character]);

 function safeURL(destination) {
  // Reject control characters, spaces and every scheme other than explicit HTTP(S).
  if (!/^https?:\/\//i.test(destination) || /[\u0000-\u0020\u007f]/.test(destination)) return null;
  try {
   const url = new URL(destination);
   return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.href : null;
  } catch (_) { return null; }
 }

 function inline(text, depth = 0) {
  if (depth > 4) return escapeHTML(text);
  let result = '', position = 0;
  while (position < text.length) {
   const rest = text.slice(position);
   if (rest[0] === '\\' && rest.length > 1 && /[\\`*\[\]()|]/.test(rest[1])) {
    result += escapeHTML(rest[1]); position += 2; continue;
   }
   if (rest[0] === '`') {
    const delimiter = rest.match(/^`+/)[0];
    const end = text.indexOf(delimiter, position + delimiter.length);
    if (end !== -1) {
     result += '<code>' + escapeHTML(text.slice(position + delimiter.length, end)) + '</code>';
     position = end + delimiter.length; continue;
    }
    result += escapeHTML(delimiter); position += delimiter.length; continue;
   }
   if (rest.startsWith('**')) {
    const end = text.indexOf('**', position + 2);
    if (end > position + 2) {
     result += '<strong>' + inline(text.slice(position + 2, end), depth + 1) + '</strong>';
     position = end + 2; continue;
    }
   }
   if (rest[0] === '[') {
    // Nested brackets and parenthesized URLs stay readable as plain text.
    const link = rest.match(/^\[([^\[\]\n]+)\]\(([^()\n]*)\)/);
    if (link) {
     const url = safeURL(link[2]);
     result += url
      ? '<a href="' + escapeHTML(url) + '" target="_blank" rel="noopener noreferrer">' + inline(link[1], depth + 1) + '</a>'
      : escapeHTML(link[0]);
     position += link[0].length; continue;
    }
   }
   result += escapeHTML(rest[0]); position += 1;
  }
  return result;
 }

 function cells(line) {
  const source = line.trim(), values = [];
  let value = '', position = 0, codeDelimiter = 0, hasPipe = false;
  while (position < source.length) {
   const character = source[position];
   if (character === '\\' && position + 1 < source.length) {
    value += source.slice(position, position + 2); position += 2; continue;
   }
   if (character === '`') {
    const run = source.slice(position).match(/^`+/)[0];
    if (!codeDelimiter) codeDelimiter = run.length;
    else if (codeDelimiter === run.length) codeDelimiter = 0;
    value += run; position += run.length; continue;
   }
   if (character === '|' && !codeDelimiter) {
    values.push(value.trim()); value = ''; hasPipe = true;
   } else value += character;
   position += 1;
  }
  values.push(value.trim());
  if (!hasPipe) return null;
  if (source.startsWith('|')) values.shift();
  if (source.endsWith('|') && values[values.length - 1] === '') values.pop();
  return values;
 }

 function tableAt(lines, index) {
  const header = cells(lines[index]), separators = cells(lines[index + 1] || '');
  if (!header || !header.length || !separators || header.length !== separators.length ||
      !separators.every(cell => /^:?-{3,}:?$/.test(cell))) return null;
  const alignment = separators.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left');
  return {header, alignment};
 }

 function fence(line) { return line.match(/^ {0,3}(`{3,}|~{3,})\s*([^`]*)$/); }
 function heading(line) {
  const match = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*$/);
  if (match) match[2] = match[2].replace(/\s+#+$/, '');
  return match;
 }
 function listItem(line) {
  const unordered = line.match(/^ {0,3}[-+*]\s+(.+)$/);
  if (unordered) return {ordered:false, content:unordered[1]};
  const ordered = line.match(/^ {0,3}(\d{1,9})[.)]\s+(.+)$/);
  return ordered ? {ordered:true, number:Number(ordered[1]), content:ordered[2]} : null;
 }

 function format(value) {
  const lines = String(value == null ? '' : value).replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let index = 0;
  while (index < lines.length) {
   const line = lines[index];
   if (!line.trim()) { index += 1; continue; }
   const code = fence(line);
   if (code) {
    const content = [], delimiter = code[1][0], minimum = code[1].length;
    index += 1;
    while (index < lines.length) {
     const closing = lines[index].trim();
     if (closing.length >= minimum && [...closing].every(character => character === delimiter)) { index += 1; break; }
     content.push(lines[index]); index += 1;
    }
    const language = code[2].trim().slice(0, 80);
    output.push('<div class="md-code">' + (language ? '<span class="md-code-language">' + escapeHTML(language) + '</span>' : '') +
     '<pre dir="ltr"><code>' + escapeHTML(content.join('\n')) + '</code></pre></div>');
    continue;
   }
   const title = heading(line);
   if (title) {
    // Answer headings are subordinate to the application’s own page title.
    const level = Math.min(6, title[1].length + 2);
    output.push('<h' + level + '>' + inline(title[2]) + '</h' + level + '>'); index += 1; continue;
   }
   const table = tableAt(lines, index);
   if (table) {
    const row = (values, tag) => '<tr>' + values.map((cell, column) => '<' + tag + ' class="md-align-' + table.alignment[column] + '"' +
     (tag === 'th' ? ' scope="col"' : '') + '>' + inline(cell) + '</' + tag + '>').join('') + '</tr>';
    let body = ''; index += 2;
    while (index < lines.length && lines[index].trim()) {
     const values = cells(lines[index]);
     if (!values || values.length !== table.header.length || fence(lines[index]) || heading(lines[index])) break;
     body += row(values, 'td'); index += 1;
    }
    output.push('<div class="md-table-wrap" role="region" aria-label="Response table" tabindex="0"><table class="md-table"><thead>' +
     row(table.header, 'th') + '</thead><tbody>' + body + '</tbody></table></div>');
    continue;
   }
   const item = listItem(line);
   if (item) {
    const tag = item.ordered ? 'ol' : 'ul', start = item.ordered && item.number !== 1 ? ' start="' + item.number + '"' : '';
    const items = [];
    while (index < lines.length) {
     const next = listItem(lines[index]);
     if (!next || next.ordered !== item.ordered) break;
     const content = [next.content]; index += 1;
     // A simple indented continuation stays attached to its list item.
     while (index < lines.length && /^ {2,}\S/.test(lines[index]) && !listItem(lines[index]) && !fence(lines[index]) && !heading(lines[index])) {
      content.push(lines[index].trim()); index += 1;
     }
     items.push('<li>' + content.map(part => inline(part)).join('<br>') + '</li>');
    }
    output.push('<' + tag + ' class="md-list"' + start + '>' + items.join('') + '</' + tag + '>'); continue;
   }
   const paragraph = [line]; index += 1;
   while (index < lines.length && lines[index].trim() && !fence(lines[index]) && !heading(lines[index]) && !listItem(lines[index]) && !tableAt(lines, index)) {
    paragraph.push(lines[index]); index += 1;
   }
   output.push('<p class="md-paragraph">' + paragraph.map(part => inline(part)).join('<br>') + '</p>');
  }
  return output.join('\n');
 }

 const api = Object.freeze({format});
 root.DepartmentMarkdown = api;
 if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

import { describe, expect, it } from 'vitest';
import { XmlError, parseXml, xmlChild, xmlChildren, xmlDescendants, xmlEscape, xmlText } from '../src/xml.ts';

describe('خواننده‌ی XML', () => {
  it('عنصر، متن، نام‌فضا، ویژگی و عنصر خودبسته', () => {
    const r = parseXml('<?xml version="1.0"?><p:Root xmlns:p="urn:x" a="1>2"><p:A> سلام </p:A><B/><C k=\'v\'>x</C></p:Root>');
    expect(r.name).toBe('Root');
    expect(r.children.map((c) => c.name)).toEqual(['A', 'B', 'C']);
    expect(xmlText(r, 'A')).toBe('سلام');
    expect(xmlText(r, 'B')).toBe('');
    expect(xmlText(r, 'Z')).toBeNull();
    expect(xmlChild(r, 'C')?.text).toBe('x');
  });

  it('موجودیت‌ها، CDATA، توضیح و BOM', () => {
    const r = parseXml('﻿<R><!-- یادداشت --><A>a &lt; b &amp; &#x41;&#66;</A><B><![CDATA[<raw & text>]]></B></R>');
    expect(xmlText(r, 'A')).toBe('a < b & AB');
    expect(xmlText(r, 'B')).toBe('<raw & text>');
  });

  it('جست‌وجوی نسل‌ها و فرزندان', () => {
    const r = parseXml('<R><L><T><U>1</U></T><T><U>2</U></T></L><T/></R>');
    expect(xmlChildren(r, 'T')).toHaveLength(1);
    expect(xmlDescendants(r, 'T')).toHaveLength(3);
    expect(xmlDescendants(r, 'U').map((x) => x.text)).toEqual(['1', '2']);
  });

  const bad: [string, string][] = [
    ['DOCTYPE و موجودیت سفارشی (XXE/میلیارد خنده)', '<!DOCTYPE r [<!ENTITY x "y">]><r>&x;</r>'],
    ['موجودیت تعریف‌نشده', '<r>&nbsp;</r>'],
    ['برچسب ناهم‌خوان', '<a><b></a></b>'],
    ['برچسب بسته‌نشده', '<a><b>'],
    ['دو ریشه', '<a/><b/>'],
    ['متن بیرون ریشه', 'x<a/>'],
    ['فایل تهی', '   '],
    ['ویژگی بسته‌نشده', '<a k="v></a>'],
    ['نویسه‌ی کنترلی', '<a>\u0001</a>'],
    ['ارجاع نویسه‌ی نامعتبر', '<a>&#0;</a>'],
    ['توضیح بسته‌نشده', '<a><!-- x </a>'],
  ];
  for (const [title, src] of bad) {
    it(`رد می‌شود: ${title}`, () => {
      expect(() => parseXml(src)).toThrow();
      try {
        parseXml(src);
      } catch (e) {
        expect(e instanceof XmlError).toBe(true);
      }
    });
  }

  it('عمق و تعداد گره محدود است', () => {
    const deep = `${'<a>'.repeat(70)}${'</a>'.repeat(70)}`;
    expect(() => parseXml(deep)).toThrow('عمق');
    expect(() => parseXml('<r><a/><a/><a/></r>', { maxNodes: 3 })).toThrow('تعداد');
  });

  it('خروجی امن: نویسه‌های مخرب escape و کنترلی حذف می‌شود', () => {
    expect(xmlEscape('a<b>&"\'c\u0001')).toBe('a&lt;b&gt;&amp;&quot;&apos;c');
    const round = parseXml(`<r>${xmlEscape('x<y>&"\'')}</r>`);
    expect(round.text).toBe('x<y>&"\'');
  });

  it('پنج هزار ردیف سریع خوانده می‌شود', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => `<Task><UID>${i}</UID><Name>فعالیت ${i}</Name></Task>`).join('');
    const t0 = Date.now();
    const r = parseXml(`<Project><Tasks>${rows}</Tasks></Project>`);
    expect(xmlDescendants(r, 'Task')).toHaveLength(5000);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

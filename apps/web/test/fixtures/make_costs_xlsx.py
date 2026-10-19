import base64
import zipfile
import os,sys
out=os.path.join(os.path.dirname(os.path.abspath(__file__)),'costs.xlsx')
head='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
ct=head+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'
rels=head+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
wb=head+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="هزینه‌ها" sheetId="1" r:id="rId1"/><sheet name="دوم" sheetId="2" r:id="rId2"/></sheets></workbook>'
wbrels=head+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'
# shared strings: 0..5 (index 3 is rich text with phonetic run, index 4 has entities, 5 empty)
ss=head+'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="8" uniqueCount="6">'+\
 '<si><t>تاریخ</t></si><si><t>کد WBS</t></si><si><t>مبلغ</t></si>'+\
 '<si><r><t xml:space="preserve">خرید </t></r><r><rPr><b/></rPr><t>مصالح</t></r><rPh sb="0" eb="1"><t>IGNORED</t></rPh></si>'+\
 '<si><t>A &amp; B &lt;1&gt; &#1601;</t></si><si><t/></si></sst>'
# sheet1: header row, row2 with gap (A2 date text via shared? use number serial in A), formulas, bool, inline
sheet1=head+'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+\
 '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>'+\
 '<row r="2"><c r="A2"><v>46312</v></c><c r="B2" t="inlineStr"><is><t>1.2.1</t></is></c><c r="C2" t="s"><v>3</v></c><c r="D2"><v>1500000</v></c></row>'+\
 '<row r="4"><c r="A4" t="str"><f>CONCAT("a","b")</f><v>ab</v></c><c r="B4" t="b"><v>1</v></c><c r="C4" t="s"><v>4</v></c><c r="D4"><f>1+1</f><v>2.5</v></c><c r="E4"/></row>'+\
 '</sheetData></worksheet>'
sheet2=head+'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>'
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    for n,d in [('[Content_Types].xml',ct),('_rels/.rels',rels),('xl/workbook.xml',wb),('xl/_rels/workbook.xml.rels',wbrels),('xl/sharedStrings.xml',ss),('xl/worksheets/sheet1.xml',sheet1),('xl/worksheets/sheet2.xml',sheet2)]:
        z.writestr(n,d)
b64=base64.b64encode(open(out,'rb').read()).decode()
ts=os.path.join(os.path.dirname(out),'costsXlsx.ts')
open(ts,'w').write("/** تولیدشده با make_costs_xlsx.py — فایل xlsx نمونه (deflate، متن مشترک، فرمول، بولی، دو برگه) */\nexport const COSTS_XLSX_BASE64 = '"+b64+"';\n")
os.remove(out)

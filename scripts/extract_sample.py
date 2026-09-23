"""Rebuild the visually reviewed seed for the bundled PDF, not general recognition.

Run: uv run --with pymupdf python scripts/extract_sample.py --pdf
     260906_백초밥-3.pdf --output tmp/sample-extraction --render

Vector-path indices are source-specific, guarded by the source SHA-256. Labels
were reviewed in full-page and detail renders; this script replays that mapping.
No Python or external service is needed by the browser application at runtime.
"""
import json, math, pathlib, hashlib, argparse
import pymupdf as fitz

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--pdf',type=pathlib.Path,default=pathlib.Path('260906_백초밥-3.pdf'))
parser.add_argument('--output',type=pathlib.Path,required=True)
parser.add_argument('--render',action='store_true',help='Also render full-page sample-plan.png')
args=parser.parse_args()
OUT=args.output;OUT.mkdir(parents=True,exist_ok=True)
PDF=args.pdf
expected='ec73b152cbaf88f5628964a06e3c261df5eba131d07111b985cfada68a648779'
actual=hashlib.sha256(PDF.read_bytes()).hexdigest()
if actual!=expected:
    raise SystemExit('This reviewed mapping applies only to the bundled source PDF. SHA-256 mismatch; refusing to apply source-specific geometry.')
page=fitz.open(PDF)[0]
draw=page.get_drawings()
SX=8800/(573.60-261.84)
SY=21200/(913.20-162)
def xy(x,y): return ((x-261.84)*SX,(y-162)*SY)
def pt(x,y):
    a,b=xy(x,y); return {'x':round(a,1),'y':round(b,1)}
def entity(id,type,name,x,y,w,d,h,rotation=0,confidence=.93,notes='',**extra):
    return dict(id=id,type=type,name=name,x=round(x,1),y=round(y,1),z=0,width=round(w,1),depth=round(d,1),height=h,rotation=round(rotation,3),confidence=confidence,source='floorplan',notes=notes,**extra)
def rect(id,type,name,r,h=850,dimensions=None,confidence=.94,notes='',rotation=0,**extra):
    if isinstance(r,int):
        i=r;r=draw[r]['rect'];extra['sourcePath']=i
    x,y=xy(r[0],r[1]);w=(r[2]-r[0])*SX;d=(r[3]-r[1])*SY
    extra['sourceBounds']=list(r)
    if dimensions:
        nw,nd=dimensions;x+=(w-nw)/2;y+=(d-nd)/2;w,d=nw,nd
    return entity(id,type,name,x,y,w,d,h,rotation,confidence,notes,**extra)
def line(id,type,name,p1,p2,t,h=2800,confidence=.93,notes='',**extra):
    ax,ay=xy(*p1);bx,by=xy(*p2)
    w=math.hypot(bx-ax,by-ay);rot=math.degrees(math.atan2(by-ay,bx-ax))
    return entity(id,type,name,(ax+bx)/2-w/2,(ay+by)/2-t/2,w,t,h,rot,confidence,notes,**extra)

plan=dict(version=1,name='백초밥 · Floor Plan Review',units='mm',bounds=dict(width=8800,depth=21200),
  floorOutline=[pt(*p) for p in [(261.84,385.92),(286.56,385.92),(286.56,364.08),(281.28,355.68),(573.6,166.32),(573.6,913.2),(261.84,913.2)]],
  settings=dict(wallHeight=2800,ceilingHeight=2800,wallThickness=100,doorHeight=2100,furnitureHeight=750,material='warm-neutral',lighting=1),
  overlay=dict(x=round(-261.84*SX,5),y=round(-162*SY,5),width=round(page.rect.width*SX,5),depth=round(page.rect.height*SY,5),pageWidth=page.rect.width,pageHeight=page.rect.height,page=1,url='/sample-plan.png'),
  sourceFile=PDF.name,sourceSha256=hashlib.sha256(PDF.read_bytes()).hexdigest(),
  calibration=dict(xPdf=261.84,yPdf=162,mmPerPdfPointX=SX,mmPerPdfPointY=SY,widthReference=8800,depthReference=21200),
  walls=[],doors=[],windows=[],zones=[],objects=[])
W=plan['walls'];D=plan['doors'];O=plan['objects'];Z=plan['zones']
heightNote='Footprint traced from vector lines. Height 2800 mm is an editable assumption.'
for id,name,r,h,c,n in [
 ('wall-west','서측 외벽',(254.88,385.92,261.84,920.16),2800,.93,heightNote+' Exterior thickness about 197 mm is measured, not dimensioned.'),
 ('wall-east','동측 외벽',(573.60,162,580.56,920.16),2800,.95,heightNote+' Exterior thickness about 197 mm is measured, not dimensioned.'),
 ('wall-south','남측 외벽',(261.84,913.20,573.60,920.16),2800,.95,heightNote),
 ('wall-lower-lining','하부 100 mm 칸막이',(261.84,909.60,573.60,913.20),2800,.92,heightNote),
 ('wall-private-top','개별 식사실 상부 칸막이',(261.84,616.32,403.44,619.92),2800,.98,heightNote),
 ('wall-private-east-a','식사실 1 출입구 위',(400.08,619.92,403.44,650.88),2800,.98,heightNote),
 ('wall-private-east-b','식사실 출입구 사이',(400.08,682.80,403.44,748.56),2800,.98,heightNote),
 ('wall-private-east-c','식사실 2 출입구 아래',(400.08,780.48,403.44,811.44),2800,.98,heightNote),
 ('wall-private-divider-a','식사실 사이 서측 칸막이',(286.56,713.76,327.36,717.36),2800,.96,heightNote),
 ('wall-private-divider-b','식사실 사이 동측 칸막이',(359.28,713.76,400.08,717.36),2800,.96,heightNote),
 ('wall-toilet-top','화장실 상부 칸막이',(261.84,811.44,403.44,815.04),2800,.97,heightNote),
 ('wall-toilet-east','화장실 동측 칸막이',(400.08,846.96,403.44,909.60),2800,.96,heightNote),
 ('wall-kitchen-west','주방 서측 칸막이',(445.44,590.64,448.80,836.88),2800,.97,heightNote),
 ('wall-kitchen-top','주방 상부 칸막이',(496.80,590.64,573.60,594.24),2800,.78,heightNote+' Full-height versus counter-height is not specified.'),
 ('wall-utility-west','다용도실 서측 칸막이',(445.44,840.48,448.80,909.60),2800,.97,heightNote),
 ('wall-utility-top','다용도실 상부 칸막이',(445.44,836.88,541.68,840.48),2800,.98,heightNote),
 ('wall-private-west','식사실 서측 얇은 구획',(286.56,619.92,288.36,811.44),2800,.55,'One boundary line only. Thickness 50 mm and height are assumptions; may be built-in lining rather than a wall.')]:
    W.append(rect(id,'wall',name,r,h,confidence=c,notes=n))
# Stepped north-west envelope and frontage. Entrance gap is preserved.
W.extend([
 line('wall-west-upper','wall','서측 상부 외벽',(258.36,368.64),(258.36,385.92),197,notes=heightNote),
 line('wall-nw-jog-a','wall','입면 꺾임 A',(261.84,385.92),(286.56,385.92),100,confidence=.75,notes=heightNote),
 line('wall-nw-jog-b','wall','입면 꺾임 B',(286.56,385.92),(286.56,364.08),100,confidence=.75,notes=heightNote),
 line('wall-nw-jog-c','wall','입면 꺾임 C',(286.56,364.08),(279.36,352.80),100,confidence=.75,notes=heightNote),
 line('wall-nw-short','wall','서측 사선 연결',(254.88,368.64),(279.36,352.80),100,confidence=.8,notes=heightNote),
 line('wall-facade-west','wall','사선 입면 · 서측',(280.08,352.32),(411.12,267.36),100,confidence=.65,notes='Multi-line frontage traced. Glazing, sill, wall construction and height are unconfirmed.'),
 line('wall-facade-east','wall','사선 입면 · 동측',(471.36,228.24),(573.60,162),100,confidence=.65,notes='Multi-line frontage traced. Glazing, sill, wall construction and height are unconfirmed.')])

D.append(line('door-entry','swing-double','주 출입구 · 양개문',(413.52,270),(472.08,232.08),100,2100,.94,'Double swing arcs visible. Opening width is vector-derived (~1970 mm); height assumed.'))
D.extend([
 line('door-private-1','sliding','식사실 1 슬라이딩 도어',(401.76,650.88),(401.76,682.80),100,2100,.98,'슬라이딩도어 text and gap verified; width about 900 mm.',wallId='wall-private-east-a'),
 line('door-private-2','sliding','식사실 2 슬라이딩 도어',(401.76,748.56),(401.76,780.48),100,2100,.98,'슬라이딩도어 text and gap verified; width about 900 mm.',wallId='wall-private-east-c'),
 line('door-private-link','sliding','식사실 사이 슬라이딩 도어',(327.36,715.56),(359.28,715.56),100,2100,.98,'슬라이딩도어 text and gap verified; width about 900 mm.',wallId='wall-private-divider-a'),
 line('door-toilet','swing','화장실 출입문',(401.76,816),(401.76,846.96),100,2100,.93,'Swing arc and leaf verified; width from vector opening.',wallId='wall-toilet-east'),
 line('door-utility','swing','다용도실 출입문',(541.68,838.68),(573.60,838.68),100,2100,.93,'Swing arc and leaf verified; width from vector opening.',wallId='wall-utility-top')])

for id,name,r,c in [
 ('zone-dining','홀 · 오픈 다이닝',(261.84,162,573.60,590.64),.94),
 ('zone-private-1','개별 식사실 1',(286.56,619.92,400.08,713.76),.95),
 ('zone-private-2','개별 식사실 2',(286.56,717.36,400.08,811.44),.95),
 ('zone-kitchen','주방',(448.80,594.24,573.60,836.88),.98),
 ('zone-toilet','화장실',(261.84,815.04,400.08,909.60),.98),
 ('zone-utility','다용도실',(448.80,840.48,573.60,909.60),.98),
 ('zone-corridor','중앙 통로',(403.44,619.92,445.44,909.60),.88)]:
    zone=rect(id,'zone',name,r,0,confidence=c,notes='Zone extents are traced; descriptive private-room/corridor names are inferred.')
    if id=='zone-dining': zone['polygon']=[pt(*p) for p in [(261.84,385.92),(286.56,385.92),(286.56,364.08),(281.28,355.68),(573.6,166.32),(573.6,590.64),(445.44,590.64),(445.44,616.32),(261.84,616.32)]]
    Z.append(zone)

tablePaths=[719,786,585,652,853,920,987,1054,1303,1370,1169,1236,1555,1622,444,511]
for idx,path in enumerate(tablePaths,1):
    O.append(rect(f'table-{idx:02}','table',f'다이닝 테이블 {idx:02}',path,750,(1000,750),.98,'Printed 1000×750 mm. Center from vector rectangle; table height assumed.'))
for idx,path in enumerate([298,255,346,394],17):
    O.append(rect(f'table-{idx:02}','table',f'벤치측 테이블 {idx-16}',path,750,(750,1200),.72,'Printed 1200×750 mm takes priority; vector symbol is approximately 1250×705 mm. Center preserved; needs dimension review.'))

# Each chair glyph consists of twelve consecutive vector drawing paths. The
# distinctive six-segment backrest identifies all 72 glyphs in this source.
chairMarkers=[]
for i,r in enumerate(draw):
    b=r['rect']
    if len(r['items'])==6 and ((10<b.width<18 and 1<b.height<3) or (1<b.width<3 and 10<b.height<18)) and 260<b.x0<580 and 180<b.y0<820:
        chairMarkers.append(i)
assert len(chairMarkers)==72
for n,i in enumerate(chairMarkers,1):
    rs=[d['rect'] for d in draw[i:i+12]]
    r=fitz.Rect(min(b.x0 for b in rs),min(b.y0 for b in rs),max(b.x1 for b in rs),max(b.y1 for b in rs))
    marker=draw[i]['rect']
    rotation=90 if marker.width<3 else (0 if marker.y0<(r.y0+r.y1)/2 else 180)
    ob=rect(f'chair-{n:02}','chair',f'의자 {n:02}',r,820,confidence=.90,notes='Position and footprint from the twelve-path chair symbol. Height is assumed; footprint is diagrammatic, not a printed dimension.')
    ob['sourcePath']=i
    if rotation==90:
        cx=ob['x']+ob['width']/2;cy=ob['y']+ob['depth']/2
        ob['width'],ob['depth']=ob['depth'],ob['width']
        ob['x']=round(cx-ob['width']/2,1);ob['y']=round(cy-ob['depth']/2,1)
    ob['rotation']=rotation;O.append(ob)
O.append(rect('bench-west','bench','붙박이 벤치 · D500',236,850,(500,6500),.91,'W VAR × D500 is printed. Length about 6500 mm measured from vector endpoints. Seat and back height assumed.'))

equip=[
 ('sink-east','sink','싱크대 · 900×750',215,(750,900),850,.98),
 ('worktop-east','counter','3단 작업대 · 900×600',220,(600,900),850,.98),
 ('dishwasher','dishwasher','세척기 · 750×750',221,(750,750),850,.98),
 ('fridge-east','refrigerator','T냉장 + 벽선반 · 1500×750',222,(750,1500),850,.98),
 ('freezer','refrigerator','45박스 냉동냉장고 · 1280×750',223,(1280,750),1900,.98),
 ('sink-island','sink','싱크대 · 900×750',224,(900,750),850,.98),
 ('worktop-island','counter','3단 작업대 · 1200×750',225,(1200,750),850,.98),
 ('fridge-island-4','refrigerator','T냉장 1/2 4칸 · 1200×750',226,(1200,750),850,.98),
 ('fridge-island-3','refrigerator','T냉장 · 900×750',227,(900,750),850,.98),
 ('worktop-cook','counter','3단 작업대 · 600×750',228,(600,750),850,.74),
 ('range','range','간택기 + 닥트 · 900×750',229,(900,750),850,.93),
 ('fryer','fryer','1단 작업대 + 튀김기 · 600×750',230,(600,750),850,.74),
 ('ice-maker','iceMaker','제빙기 · 350×600',231,(350,600),850,.97),
 ('dish-shelf','shelf','배식대 · 900×300',232,(900,300),1100,.92),
 ('fridge-island-1','refrigerator','T냉장 · 900×750',233,(900,750),850,.98),
 ('showcase-west-kitchen','showcase','쇼케이스 · 500×450',234,(450,500),1200,.97),
 ('fridge-island-2','refrigerator','T냉장 · 900×750',235,(900,750),850,.97),
 ('showcase-north-1','showcase','쇼케이스 · 500×450',1148,(500,450),1200,.98),
 ('showcase-north-2','showcase','쇼케이스 · 500×450',1149,(500,450),1200,.98),
 ('self-bar','counter','셀프바 + 상부 2단선반 · 900×750',1150,(900,750),900,.98),
 ('worktop-north','counter','3단 작업대 · 1200×600',1685,(1200,600),850,.98),
 ('showcase-self','showcase','쇼케이스 · 500×450',1699,(500,450),1200,.98),
 ('sink-small','sink','싱크대 · 600×600',2024,(600,600),850,.98),
 ('dish-rack','shelf','4단 퇴식대 · 600×600',2025,(600,600),1500,.82),
 ('rice-bin','riceBin','3말 쌀통 · 845×500',2026,(845,500),900,.97)]
for id,type,name,path,dim,h,c in equip:
    notes='Label footprint prioritized; position from source vector rectangle. Height/material assumed.'
    if c==.74:notes+=' Printed depth 750 mm differs from drawn symbol depth approximately 700 mm.'
    if id=='dish-rack':notes+=' Text visually resembles 4단 퇴식대; exact label needs review.'
    if id=='dish-shelf':notes+=' This shelf overlaps the refrigerator footprint in plan, indicating stacking. z=850 mm is an assumption.'
    ob=rect(id,type,name,path,h,dim,c,notes)
    if id=='dish-shelf':ob['z']=850;ob['height']=250
    O.append(ob)
for id,r in [('counter-divider-upper',(448.8,665.04,525.84,668.64)),('counter-divider-lower',(448.8,748.32,523.2,751.92))]:
    O.append(rect(id,'counter', '주방 작업대 사이 구획',r,1100,confidence=.55,notes='100 mm wide drawn divider; top height and function unknown. Assumed low backsplash, not verified wall.'))
for id,name,r in [('washbasin-toilet','화장실 세면대',(382.32,846.96,400.08,909.60)),('washbasin-corridor','통로 세면대',(403.44,891.84,445.44,909.60))]:
    O.append(rect(id,'sink',name,r,850,confidence=.70,notes='Circular basin-like plumbing symbol on a rectangular counter. Precise fixture identity and height require review. No toilet fixture is invented.'))
O.extend([
 rect('column-east-a','column','동측 기둥 1',4,2800,confidence=.83,notes='Square structural-looking projection in wall; function and height unconfirmed.'),
 rect('column-east-b','column','동측 기둥 2',3,2800,confidence=.83,notes='Square structural-looking projection in wall; function and height unconfirmed.'),
 rect('column-west','column','서측 돌출부',(261.84,635.04,286.56,659.76),2800,confidence=.75,notes='Square wall projection shown. Structural role and height unconfirmed.')])
plan['reviewNotes']=[
 '도면 높이·재질·조명은 미기재입니다. 기본값을 검토하세요.',
 '벤치측 테이블 4개: 라벨 1200×750과 그려진 외곽이 다릅니다.',
 '작업대/튀김기 600×750 두 개의 도형 깊이는 약 700입니다. 라벨값을 사용했습니다.',
 '사선 입면 유리 여부, 개구부 높이, 주방 구획 높이는 확인되지 않았습니다.',
 '기준 치수 8800×21200은 도면 치수 기준선 사이 거리입니다. 외벽 일부는 기준선 밖에 있습니다.',
 '장비 footprint는 라벨/벡터를 따릅니다. 3D 형태는 제품 CAD가 아닌 단순 체적입니다.'
]
OUT.joinpath('floorplan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf-8')
if args.render:
    page.get_pixmap(matrix=fitz.Matrix(3,3)).save(str(OUT/'sample-plan.png'))
print('Saved',len(W),'walls',len(D),'doors',len(Z),'zones',len(O),'objects')
print('Types', {t:sum(o['type']==t for o in O) for t in set(o['type'] for o in O)})
print('Overlay',plan['overlay'])

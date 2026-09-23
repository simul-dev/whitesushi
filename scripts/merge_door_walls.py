"""Normalize reviewed sample walls into editable continuous supports.

Usage: python merge_door_walls.py --input floorplan.json --output normalized.json
Only this source mapping is supported. No arbitrary wall-gap inference is used.
"""
import argparse, copy, json, math, pathlib

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--input',type=pathlib.Path,required=True)
parser.add_argument('--output',type=pathlib.Path,required=True)
args=parser.parse_args()
plan=json.loads(args.input.read_text(encoding='utf-8-sig'))
assert plan['sourceSha256']=='ec73b152cbaf88f5628964a06e3c261df5eba131d07111b985cfada68a648779'
sx=plan['calibration']['mmPerPdfPointX'];sy=plan['calibration']['mmPerPdfPointY']
def xy(p):return ((p[0]-261.84)*sx,(p[1]-162)*sy)
def rr(v):return round(v,4)
wallmap={e['id']:e for e in plan['walls']}
doors={e['id']:e for e in plan['doors']}

def merge_rect(id,name,oldIds,r):
    out=copy.deepcopy(wallmap[oldIds[0]])
    x,y=xy(r[:2]);x2,y2=xy(r[2:])
    out.update(id=id,name=name,x=rr(x),y=rr(y),width=rr(x2-x),depth=rr(y2-y),rotation=0,
      sourceBounds=r,source='floorplan',mergedFrom=oldIds,
      notes='Continuous wall support reconstructed from collinear source segments. Doors cut this support at their current JSON position and height. Wall height and material remain assumptions. The inferred lintel above each opening is NOT specified by the source.')
    for old in oldIds:wallmap.pop(old)
    wallmap[id]=out
    return out

east=merge_rect('wall-private-east-continuous','식사실·화장실 동측 연속 벽',
 ['wall-private-east-a','wall-private-east-b','wall-private-east-c','wall-toilet-east'],
 [400.08,619.92,403.44,909.60])
for id in ['door-private-1','door-private-2','door-toilet']:doors[id]['wallId']=east['id']

divider=merge_rect('wall-private-divider','식사실 사이 연속 칸막이',
 ['wall-private-divider-a','wall-private-divider-b'],[286.56,713.76,400.08,717.36])
doors['door-private-link']['wallId']=divider['id']

utility=merge_rect('wall-utility-top','다용도실 상부 연속 칸막이',
 ['wall-utility-top'],[445.44,836.88,573.60,840.48])
doors['door-utility']['wallId']=utility['id']

# The source hinge/leaf centerline sits inside the outer frontage line. Use the
# actual opening between wall segments for the aperture, not the swung leaves.
p1=xy((280.08,352.32));p2=xy((573.60,162))
dx=p2[0]-p1[0];dy=p2[1]-p1[1];L=math.hypot(dx,dy)
ux,uy=dx/L,dy/L;theta=math.degrees(math.atan2(dy,dx))
facade=copy.deepcopy(wallmap['wall-facade-west'])
facade.update(id='wall-facade-continuous',name='사선 입면 · 연속 벽',
 x=rr((p1[0]+p2[0])/2-L/2),y=rr((p1[1]+p2[1])/2-50),width=rr(L),depth=100,rotation=rr(theta),
 mergedFrom=['wall-facade-west','wall-facade-east'],
 sourceEndpoints=[[280.08,352.32],[573.60,162]],
 notes='Continuous diagonal frontage reconstructed from both collinear source segments. Glass/construction and all vertical information are unconfirmed. The opening uses the gap between facade segments, not the swung leaf line. Any lintel above doorHeight is an explicit schematic assumption.')
wallmap.pop('wall-facade-west');wallmap.pop('wall-facade-east');wallmap[facade['id']]=facade

def normalize_door(id,a,b,wallId,explanation):
    d=doors[id]
    d['sourceLeafRectangle']={k:d[k] for k in ['x','y','width','depth','rotation']}
    a,b=xy(a),xy(b)
    if id=='door-entry':
        def project(p):
            t=(p[0]-p1[0])*ux+(p[1]-p1[1])*uy
            return p1[0]+t*ux,p1[1]+t*uy
        a,b=project(a),project(b)
    length=math.dist(a,b);angle=math.degrees(math.atan2(b[1]-a[1],b[0]-a[0]))
    d.update(x=rr((a[0]+b[0])/2-length/2),y=rr((a[1]+b[1])/2-50),width=rr(length),depth=100,rotation=rr(angle),wallId=wallId,
      notes=d['notes']+' '+explanation+' Door height and the resulting wall lintel are assumptions.')

normalize_door('door-entry',(411.12,267.36),(471.36,228.24),facade['id'],
 'Aperture corrected to the measured outer-frame gap (~2027 mm); previous1969 mm leaf measurement is preserved as sourceLeafRectangle. Center projected to the frontage support axis (about101 mm shift).')
normalize_door('door-toilet',(401.76,815.04),(401.76,846.96),east['id'],
 'Aperture corrected to the wall-jamb gap (~901 mm), not leaf-only extent (~874 mm). Original leaf measurement is preserved as sourceLeafRectangle.')

# Put all apertures on their exact support midline and extend their depth enough
# to cover that source thickness. This removes sub-millimetre residual strips.
for id in ['door-private-1','door-private-2','door-toilet']:
    d=doors[id];cx=east['x']+east['width']/2;cy=d['y']+d['depth']/2
    d['depth']=rr(east['width']);d['x']=rr(cx-d['width']/2);d['y']=rr(cy-d['depth']/2)
for id,w in [('door-private-link',divider),('door-utility',utility)]:
    d=doors[id];cx=d['x']+d['width']/2;cy=w['y']+w['depth']/2
    d['depth']=rr(w['depth']);d['x']=rr(cx-d['width']/2);d['y']=rr(cy-d['depth']/2)

plan['walls']=list(wallmap.values())
# Preserve the traced footprint while making the bench's parametric backrest
# run along the west wall. Apply only to the original unswapped seed geometry.
bench=next((e for e in plan['objects'] if e['id']=='bench-west'),None)
if bench and bench['depth']>bench['width'] and bench['rotation']==0:
    cx=bench['x']+bench['width']/2;cy=bench['y']+bench['depth']/2
    bench['width'],bench['depth']=bench['depth'],bench['width']
    bench['x']=rr(cx-bench['width']/2);bench['y']=rr(cy-bench['depth']/2);bench['rotation']=270
    bench['notes']+=' Local axes rotated270° around the preserved footprint centre so the backrest follows the west wall.'
plan['reviewNotes'].append('문은 연속 벽에서 현재 위치·높이만큼 개구부를 차감합니다. 문 위 인방과 입면 높이는 도면에 없는 가정입니다.')
plan['reviewNotes'].append('출입구 약2027 mm, 화장실 약901 mm는 벽 사이 틈 기준입니다. 기존 문짝 외곽 측정치는 sourceLeafRectangle에 보관했습니다.')
args.output.write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf-8')
print('walls',len(plan['walls']),'doors',len(plan['doors']))
for d in plan['doors']:print(d['id'],d['wallId'],d['width'],d['depth'],d['rotation'])

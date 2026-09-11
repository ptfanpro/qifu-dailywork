"""Image-only OCR windows from correlated patch proposals, never identity.

Unlike the region classifier, small regions may propose extra reading windows.
This does not lower a recognition acceptance threshold: no role or code is
assigned. Both views must overlap spatially. Original full-frame observations
must be retained by the caller, including contradictory and partial strings.
"""
import importlib.util
from pathlib import Path
import math

spec=importlib.util.spec_from_file_location('patch_geometry',Path(__file__).with_name('paper-patch-supervision.py'))
geometry=importlib.util.module_from_spec(spec);spec.loader.exec_module(geometry)

def reading_windows(width,height,regions):
    grids=[geometry.patch_boxes(width,height,v) for v in ('center-crop','full-frame')]
    if not isinstance(regions,(list,tuple)) or len(regions)!=2:
        raise ValueError('Exactly two explicit patch views required')
    boxes=[]
    for cells,grid in zip(regions,grids):
        if not isinstance(cells,(list,tuple)) or len(cells)>196:raise ValueError('Bounded cells required')
        seen=set()
        for cell in cells:
            if not isinstance(cell,(list,tuple)) or len(cell)!=2 or any(type(v) is not int or v<0 or v>=14 for v in cell):
                raise ValueError('Integer patch coordinates required')
            key=tuple(cell)
            if key in seen:raise ValueError('Duplicate cell')
            seen.add(key)
        if not seen:boxes.append(None);continue
        connected=set();todo=[next(iter(seen))]
        while todo:
            key=todo.pop()
            if key in connected:continue
            connected.add(key);y,x=key
            todo.extend(p for p in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)) if p in seen and p not in connected)
        if connected!=seen:raise ValueError('One connected proposal required per view')
        rows=grid[[y*14+x for y,x in seen]]
        boxes.append([float(rows[:,0].min()),float(rows[:,1].min()),float(rows[:,2].max()),float(rows[:,3].max())])
    result={'recipe':'paper-region-read-windows-v1','windows':[],
            'paperRoleVerified':False,'codeVerified':False,'mayAuthorizeUpload':False,'independentViews':False}
    if any(b is None for b in boxes):return result
    a,b=boxes
    if max(a[0],b[0])>=min(a[2],b[2]) or max(a[1],b[1])>=min(a[3],b[3]):return result
    union=[min(a[0],b[0]),min(a[1],b[1]),max(a[2],b[2]),max(a[3],b[3])]
    unique=set()
    for padding in (1,2):
        # Padding is fixed in full-frame patch units, not chosen by OCR/PDF.
        left=max(0,math.floor((union[0]-padding/14)*width))
        top=max(0,math.floor((union[1]-padding/14)*height))
        right=min(width,math.ceil((union[2]+padding/14)*width))
        bottom=min(height,math.ceil((union[3]+padding/14)*height))
        identity=(left,top,right,bottom)
        if identity in unique:continue
        unique.add(identity)
        result['windows'].append({'left':left,'top':top,'width':right-left,'height':bottom-top,'paddingCells':padding})
    return result

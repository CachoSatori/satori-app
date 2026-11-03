import pandas as pd, re, unicodedata
def norm(s): 
  s=unicodedata.normalize('NFKD',str(s)).encode('ascii','ignore').decode().upper()
  return re.sub(r'\s+',' ',s).strip()
q=pd.read_csv('datos/q6.csv')
pos=pd.read_excel('datos/costos/costos.xls',header=0)
pos['k']=pos.Nombre.map(norm); pos=pos[pos.CostoUnitario>0]
posc=pos.groupby('k').agg(c=('CostoUnitario','last'),p=('PrecioVenta','last'))
cg=pd.read_excel('datos/costos/cogs.xlsx',sheet_name='CoGS Nosara',header=None).iloc[5:101,[2,5]].dropna()
cg.columns=['n','c']; cg['k']=cg.n.map(norm); cgc=cg.groupby('k').c.last()
lines=q[q.nombre!='__PAX__'].copy(); lines['k']=lines.nombre.map(norm)
def unit_cost(r):
  if r.k in cgc.index: return cgc[r.k],'cogs26'
  if r.k in posc.index: return posc.loc[r.k,'c'],'pos'
  return None,'pct'
uc=lines.apply(lambda r: pd.Series(unit_cost(r),index=['uc','src']),axis=1)
lines=pd.concat([lines,uc],axis=1)
fampct={5:0.33,2:0.22,3:0.18,4:0.23,13:0.25,16:0.25,29:0.37,22:0.30,21:0.5}
lines['costo']=lines.apply(lambda r: r.uc*r.cantidad if pd.notna(r.uc) else r.neta*fampct.get(r.familia,0.30),axis=1)
# cap absurd (cost > neta*1.2) -> pct
bad=lines.costo>lines.neta.clip(lower=1)*1.2
lines.loc[bad,'costo']=lines.loc[bad].apply(lambda r:r.neta*fampct.get(r.familia,0.30),axis=1); lines.loc[bad,'src']='pct*'
print(lines.groupby('src').neta.sum()/lines.neta.sum())
pax=q[q.nombre=='__PAX__'].set_index(['periodo','con_md']).cantidad
g=lines.groupby(['periodo','con_md']).agg(neta=('neta','sum'),costo=('costo','sum'))
g['pax']=pax; g['neta_pax']=(g.neta/g.pax).round(); g['costo_pax']=(g.costo/g.pax).round(); g['margen_pax']=g.neta_pax-g.costo_pax; g['pct_costo']=(100*g.costo/g.neta).round(1)
print(g.to_string())
lines.to_csv('lines_cost.csv',index=False)

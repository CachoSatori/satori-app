import pandas as pd, re, unicodedata
def norm(s):
  s=unicodedata.normalize('NFKD',str(s)).encode('ascii','ignore').decode().upper()
  return re.sub(r'\s+',' ',s).strip()
pos=pd.read_excel('datos/costos/costos.xls',header=0); pos['k']=pos.Nombre.map(norm); pos=pos[pos.CostoUnitario>0]
posc=pos.groupby('k').CostoUnitario.last()
cg=pd.read_excel('datos/costos/cogs.xlsx',sheet_name='CoGS Nosara',header=None).iloc[5:101,[2,5]].dropna(); cg.columns=['n','c']; cg['k']=cg.n.map(norm); cgc=cg.groupby('k').c.last()
fampct={5:0.33,2:0.22,3:0.18,4:0.23,13:0.25,16:0.25,29:0.37,22:0.30,21:0.5,12:0.0,1:0.3}
def cost(df):
  df=df.copy(); df['k']=df.nombre.map(norm)
  def f(r):
    if r.k=='BOXING': return r.neta  # pasaje directo
    uc=cgc.get(r.k, posc.get(r.k))
    c = uc*r.cantidad if uc is not None and pd.notna(uc) else r.neta*fampct.get(r.familia,0.30)
    if c>max(r.neta,1)*1.2: c=r.neta*fampct.get(r.familia,0.30)
    return c
  df['costo']=df.apply(f,axis=1); return df

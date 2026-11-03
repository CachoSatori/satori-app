import pandas as pd, numpy as np
d=pd.read_csv('datos/r7/q21.csv'); d['mes']=pd.to_datetime(d.mes)
def cls(r):
    if r.segmento=='local_club': return 'LC marcado'
    x=r.ratio
    if x>=0.97: return 'sin descuento'
    if 0.88<=x<=0.93: return 'tarjeta 10%'
    if 0.80<=x<=0.87: return 'LC sin marcar 15%'
    return 'otro'
d['clase']=d.apply(cls,axis=1)
d['costo']=np.where(d.con_md, 0.32*d.valor_lista, 0.24*d.valor_lista)
d['desc']=d.valor_lista-d.neta
# LC ratio por mes (noche)
n=d[d.turno=='noche']
lc=n[n.segmento=='local_club']
m=lc.groupby('mes').apply(lambda g: pd.Series({'ratio_pond':g.neta.sum()/g.valor_lista.sum(),'moda':g.groupby('ratio').mesas.sum().idxmax(),'mesas':g.mesas.sum()}))
print(m.round(3).to_string())
def per(m):
    if pd.Timestamp('2025-09-01')<=m<pd.Timestamp('2025-11-01'): return 'A sep-oct 2025'
    if pd.Timestamp('2025-11-01')<=m<pd.Timestamp('2025-12-01'): return 'A2 nov 2025'
    if pd.Timestamp('2026-03-01')<=m<pd.Timestamp('2026-09-01'): return 'C mar-ago 2026'
    if pd.Timestamp('2026-09-01')<=m<pd.Timestamp('2026-11-01'): return 'D sep-oct 2026'
    if pd.Timestamp('2025-07-01')<=m<pd.Timestamp('2025-09-01'): return '0 jul-ago 2025'
    return None
n=d[d.turno=='noche'].copy(); n['per']=n.mes.map(per); n=n[n.per.notna()]
nm={'A sep-oct 2025':2,'A2 nov 2025':1,'C mar-ago 2026':6,'D sep-oct 2026':2,'0 jul-ago 2025':2}
g=n.groupby(['per','clase','con_md'])[['mesas','pax','personas_lc','invitados','neta','valor_lista','costo','desc']].sum()
g['meses']=[nm[i[0]] for i in g.index]
g['venta_pax']=g.neta/g.pax; g['margen_pax']=(g.neta-g.costo)/g.pax; g['desc_%']=100*g.desc/g.valor_lista
g['margen_mes']=(g.neta-g.costo)/g.meses; g['desc_mes']=g.desc/g.meses; g['pax_mes']=g.pax/g.meses
pd.set_option('display.width',250)
print(g[['mesas','pax','pax_mes','personas_lc','venta_pax','margen_pax','desc_%','margen_mes','desc_mes']].round(1).to_string())
# share by class
t=n.groupby(['per','clase']).pax.sum().unstack(); print((t.div(t.sum(1),axis=0)*100).round(1))
# dias
h=n[n.per.isin(['A sep-oct 2025','D sep-oct 2026'])].groupby(['per','dias','clase','con_md'])[['pax','neta','costo']].sum()
h['margen_pax']=(h.neta-h.costo)/h.pax; print(h.round(0).to_string())
n['grp']=np.where(n.clase.isin(['LC marcado','LC sin marcar 15%']),'LC',n.clase)
k=n.groupby(['per','grp','con_md'])[['pax','neta','costo']].sum()
k['v']=k.neta/k.pax; k['m']=(k.neta-k.costo)/k.pax
print(k.round(0).to_string())

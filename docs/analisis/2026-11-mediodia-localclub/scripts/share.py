import pandas as pd, numpy as np
d=pd.read_csv('datos/r7/q21.csv'); d['mes']=pd.to_datetime(d.mes)
d=d[(d.mes>='2025-11-01')&(d.mes<'2026-11-01')]
def cls(r):
    x=r.ratio
    if r.segmento=='local_club': return 'LC'
    if x>=0.97: return 'sin descuento'
    if 0.88<=x<=0.93: return 'tarjeta 10%'
    if 0.80<=x<=0.87: return 'LC'
    if 0.66<=x<=0.74: return 'personal 30%'
    return 'otro'
d['clase']=d.apply(cls,axis=1)
d['costo']=np.where(d.con_md,0.32,0.24)*d.valor_lista
d['desc']=d.valor_lista-d.neta
for turno in ['noche','mañana',None]:
    x=d if turno is None else d[d.turno==turno]
    key=['clase'] if turno!='mañana' else ['clase','con_md']
    g=x.groupby(key)[['mesas','pax','neta','costo','desc']].sum()
    g['%pax']=100*g.pax/g.pax.sum(); g['%neta']=100*g.neta/g.neta.sum()
    g['venta_pax']=g.neta/g.pax; g['margen_pax']=(g.neta-g.costo)/g.pax
    g['neta_mes']=g.neta/12; g['margen_mes']=(g.neta-g.costo)/12; g['desc_mes']=g.desc/12; g['pax_mes']=g.pax/12
    print('==',turno, 'total neta/mes', round(x.neta.sum()/12), 'pax/mes', round(x.pax.sum()/12))
    print(g[['pax_mes','%pax','%neta','venta_pax','margen_pax','neta_mes','margen_mes','desc_mes']].round(1).to_string())
q=pd.read_csv('datos/q1.csv'); q['mes']=pd.to_datetime(q.mes); q=q[(q.mes>='2025-11-01')&(q.mes<'2026-11-01')]
print('q1 total neta/mes', q.groupby('turno').neta.sum()/12, q.neta.sum()/12)

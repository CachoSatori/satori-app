# Venta por persona por salonero — noche, ene–oct 2026, mesas sin descuento.
import pandas as pd
q = pd.read_csv('datos/r7/q22.csv'); q['mes'] = pd.to_datetime(q.mes)
x = q[(q.turno == 'noche') & (q.mes >= '2026-01-01') & (q.mes < '2026-11-01') & (q.clase == 'sin descuento')]
g = x.groupby('salonero')[['mesas', 'pax', 'neta']].sum(); g = g[g.pax > 200]; g['venta_pax'] = g.neta / g.pax
s = g.drop(index='(caja)', errors='ignore'); avg = s.neta.sum() / s.pax.sum()
low = s[s.venta_pax < avg]
print(g.sort_values('venta_pax', ascending=False).round(0).to_string())
print('promedio sin caja', round(avg), '| potencial por mes si los de abajo llegan al promedio', round(((avg - low.venta_pax) * low.pax).sum() / 10))

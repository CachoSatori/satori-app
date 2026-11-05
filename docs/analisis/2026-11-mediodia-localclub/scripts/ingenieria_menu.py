# Matriz de ingeniería de menú (Kasavana & Smith) — carta de noche, mar–ago 2026.
# Correr desde la carpeta del análisis: python3 scripts/ingenieria_menu.py
import pandas as pd, sys
sys.path.insert(0, 'scripts'); import costlib
q = pd.read_csv('datos/q20.csv')
x = q[(q.periodo == 'C mar-ago 2026') & (~q.con_md) & (q.cantidad > 0)]
x = x.groupby(['nombre', 'familia'], as_index=False)[['cantidad', 'neta']].sum()
x = costlib.cost(x)
food = x[x.familia.isin([2, 3, 16, 13])].copy()   # entradas, rolls, platos fuertes, kids/otros
food = food[food.cantidad >= 20]
food['cm'] = (food.neta - food.costo) / food.cantidad          # margen por plato
avg_cm = (food.neta - food.costo).sum() / food.cantidad.sum()  # corte de margen
pop_thr = 0.7 / len(food)                                      # corte de popularidad (70 % de 1/n)
food['pop'] = food.cantidad / food.cantidad.sum() >= pop_thr
food['hi'] = food.cm >= avg_cm
food['clase'] = food.apply(lambda r: 'estrella' if r['pop'] and r.hi else 'caballo' if r['pop'] else 'enigma' if r.hi else 'perro', axis=1)
food['pct_costo'] = (food.costo / food.neta * 100).round(0)
print('platos', len(food), 'margen promedio por plato', round(avg_cm))
print(food.sort_values(['clase', 'cantidad'], ascending=[True, False])[['clase', 'nombre', 'cantidad', 'cm', 'pct_costo']].round(0).to_string(index=False))

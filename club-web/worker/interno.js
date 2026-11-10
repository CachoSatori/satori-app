// Plan B de club-web: lo que comparten la Pages Function y el Worker satori-club-api (10-nov).
// · HOST_INTERNO: el host con el que la Pages Function llama al Worker por el service binding. No existe en ningún DNS: un
//   pedido que llegue al Worker con otro host no vino por el binding y se rechaza.
// · ENCABEZADO_IP: la IP real del cliente, que la Pages Function lee de CF-Connecting-IP (allí es la del cliente) y le pasa
//   al Worker. El Worker la usa para el tope por IP y por prefijo de red, y para Turnstile.
export const HOST_INTERNO = 'club-api.interno'
export const ENCABEZADO_IP = 'x-club-ip'

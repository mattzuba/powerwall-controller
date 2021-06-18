export function to (promise) {
  return promise.then(v => [null, v], err => [err]);
}
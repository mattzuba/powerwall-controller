module.exports = {
  configureWebpack: {
    devServer: {
      open: true,
      port: 8080,
      proxy: {
        '/': {
          target: 'http://localhost:3000',
          bypass: req => {
            if (req.headers.accept.indexOf('html') !== -1) {
              return '/index.html';
            }
          }
        }
      }
    }
  }
}
var path = require('path');
var express = require('express');
var inspect = require('./utils.js').inspect;
var app = express.createServer();
var RedisStore = require('connect-redis')(express);

var routes = require('./routes.js');
var io = require('./realtime.js')(app);

app.sessionStore = new RedisStore();
app.logger = require("winston");

app.configure(function () {
  app.use(express.bodyParser());
  app.use(express.cookieParser());
  app.use(express.session({ secret: "lolcathost", store: app.sessionStore }));
  app.use(express.static(path.join(__dirname, "static")));

  // log all non-static resource requests
  app.use(express.logger({
    format: 'dev',
    stream: {
      write: function (x) { app.logger.info(typeof x === 'string' ? x.trim() : x) }
    }
  }))

  // redirect to /auth when a session is not detected
  app.use(function (req, resp, next) {
    if (!req.session.user && !req.path.match(/^\/auth(\/.+)?/))
      return resp.redirect('/auth', 303);
    next();
  });

  app.set('view options', { layout: false });
});

app.get('/', routes.index);
app.get('/auth', routes.auth);
app.get('/auth/signin', routes.authSignIn);
app.get('/auth/callback', routes.authCallback);
app.get('/signout', routes.signOut);

module.exports = app;
if (!module.parent) {
  app.listen(3000);
  app.once('listening', function () {
    console.log(inspect(app.address()));
  });
}

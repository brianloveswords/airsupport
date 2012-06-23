var request = require('request');
var inspect = require('./utils.js').inspect;
var qs = require('querystring');
var config = require('./config.json');

var TWITTER_KEYWORDS = config.twitter_keywords;
var TWITTER_CONSUMER_KEY = config.twitter_consumer_key;
var TWITTER_CONSUMER_SECRET = config.twitter_consumer_secret;
var TWITTER_CALLBACK_URL = config.twitter_callback_url;

/**
 * render the index
 */

exports.index = function index(req, resp) {
  var sess = req.session.user;
  resp.render('index.ejs', {
    user: {
      token: sess.token,
      token_secret: sess.token_secret,
      user_id: sess.user_id,
      screen_name: sess.screen_name
    }
  });
};


/**
 * render the auth page
 */

exports.auth = function auth(req, resp) {
  resp.render('auth.ejs');
};


/**
 * get oauth token and redirect to twitter
 */

exports.authSignIn = function authSignIn(req, resp) {
  var oauth = {
    callback: TWITTER_CALLBACK_URL,
    consumer_key: TWITTER_CONSUMER_KEY,
    consumer_secret: TWITTER_CONSUMER_SECRET,
  }
  var url = 'https://api.twitter.com/oauth/request_token';

  request.post({ url: url, oauth: oauth }, function (err, _, body) {
    var token = qs.parse(body);
    oauth.token = token.oauth_token;
    resp.redirect('https://api.twitter.com/oauth/authenticate?oauth_token=' + oauth.token, 302)
  });
};


/**
 * handle response from twitter oauth flow
 */

exports.authCallback = function authCallback(req, resp) {
  if (req.query.denied)
    return resp.redirect('/auth', 303);

  var oauth = {
    consumer_key: TWITTER_CONSUMER_KEY,
    consumer_secret: TWITTER_CONSUMER_SECRET,
    token: req.query.oauth_token,
    verifier: req.query.oauth_verifier,
  }

  var opts = {
    oauth: oauth,
    url: 'https://api.twitter.com/oauth/access_token',
    headers: { accept: 'application/json' }
  }

  request.post(opts, function (err, twitterResp, body) {
    if (twitterResp.statusCode !== 200)
      return resp.end('something went wrong, <a href="/auth">go back and try again</a>');

    var perm = qs.parse(body);
    req.session.user = {
      oauth_token: perm.oauth_token,
      oauth_token_secret: perm.oauth_token_secret,
      user_id: perm.user_id,
      screen_name: perm.screen_name
    };

    console.log(inspect(perm));
    resp.redirect('/', 303);
  });
};


/**
 * sign the user out
 */

exports.signOut = function signOut(req, resp) {
  delete req.session.user;
  delete req.session.twitter_secret;
  resp.redirect('/auth', 303);
};
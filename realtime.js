var request = require('request');
var socketio = require('socket.io');
var db = require('./database.js');
var Tweet = db.Tweet;

var utils = require('./utils.js')
var inspect = utils.inspect;
var parseCookie = utils.parseCookie;

var qs = require('querystring');
var app = require('./server.js');
var config = require('./config.json');
var tweetStream = require('./tweetstream.js');

var TWITTER_KEYWORDS = config.twitter_keywords;
var TWITTER_CONSUMER_KEY = config.twitter_consumer_key;
var TWITTER_CONSUMER_SECRET = config.twitter_consumer_secret;
var TWITTER_CALLBACK_URL = config.twitter_callback_url;

var connectedClients = []

function setupListeners(socket, session) {
  if (!session || !session.user) {
    socket.emit('bad auth');
    return;
  }

  connectedClients.push(socket);
  socket.broadcast.emit('peer connected', session.user.screen_name);

  /**
   * `init`: Send all tweets to a client, ordered from oldest to newest
   */
  socket.on('init', function (callback) {
    var query = Tweet.find({})
    var users = connectedClients.map(function (sock) {
      return { screenName: sock.handshake.session.user.screen_name };
    });

    console.dir(users);

    query.sort('createdAt', -1)
    query.exec(function (err, docs) {
      callback({
        tweets: docs,
        session: session,
        users: users,
        monitoring: TWITTER_KEYWORDS.split(',')
      });
    });
  });

  /**
   * `send update`: A client has new data
   */
  socket.on('send update', function (data, callback) {
    // filter out the _id
    var fields = Object.keys(data).filter(function (n) {
      return n !== '_id';
    });

    // find the tweet being updated, store the new data, emit the update
    // status back to the requesting client and broadcast the update
    // to all other connected clients.
    Tweet.findById(data._id, function (err, doc) {
      if (!doc) return;

      if (err) {
        console.log('there was some sort of error updating a tweet')
        console.log(inspect(data));
        console.log(inspect(err));
        return;
      }

      fields.forEach(function (field) { doc[field] = data[field] })
      doc.save(function (err, updatedDoc) {
        if (err) {
          console.log('there was an error saving :(');
          console.dir(err);
          return callback({ error: err });
        }
        callback({ status: 'okay' })
        socket.broadcast.emit('update', updatedDoc);
      })
    });
  });


  /**
   * `outgoing tweet`: send an outgoing tweet and store a relationship to the
   * incoming tweet.
   */

  socket.on('outgoing tweet', function (msg, callback) {
    var user = session.user;
    var oauth = {
      consumer_key: TWITTER_CONSUMER_KEY,
      consumer_secret: TWITTER_CONSUMER_SECRET,
      token: session.user.oauth_token,
      token_secret: session.user.oauth_token_secret
    }

    var url, opts;
    if (msg.type === 'retweet') {
      url = 'https://api.twitter.com/1/statuses/retweet/' + msg.for.statusId + '.json';
      opts = {
        url: url,
        oauth: oauth,
        headers: { accept: 'application/json' }
      };
    }
    else {
      url = 'https://api.twitter.com/1/statuses/update.json'
      opts = {
        url: url,
        oauth: oauth,
        form: {
          status: msg.outgoing,
          in_reply_to_status_id: msg.for.statusId,
        },
        headers: { accept: 'application/json' }
      }
    }

    // do our best to post a new status on behalf of a user
    // if it succeeds, find the tweet this is in response to and
    // associate this reply.
    request.post(opts, function (err, twitterResp, body) {
      if (twitterResp.statusCode !== 200) {
        console.log(inspect(body));
        return callback({ error: body });
      }

      if (typeof body === 'string')
        body = JSON.parse(body);

      console.log('successfully sent tweet')
      var reply = {
        statusId: body.id_str,
        date: new Date(body.created_at),
        author: body.user.screen_name,
        content: body.text
      }
      if (msg.type === 'retweet') reply.retweet = true;

      Tweet.findById(msg.for._id, function (err, doc) {
        doc.replies = doc.replies || [];
        doc.replies.push(reply);

        doc.save(function (err, updatedDoc) {
          if (err) {
            console.log('there was an error saving :(');
            console.dir(err);
            return callback({ error: err });
          }
          console.log('successfully saved reply to document');
          callback({ status: 'okay', doc: updatedDoc });
          socket.broadcast.emit('update', updatedDoc);
        });
      });
    });
  });

  /**
   * `destroy model`: remove model from the database by id.
   */

  socket.on('destroy model', function (id, callback) {
    Tweet.findById(id, function (err, doc) {
      // #TODO: log error
      if (err || !doc) return callback({error: err || 'missing doc'});
      doc.remove(function () {
        callback({status: 'okay'})
        socket.broadcast.emit('tweet removed', id);
      });
    });
  });

  /**
   * `disconnect`: remove name from other clients
   */

  socket.on('disconnect', function () {
    connectedClients = connectedClients.filter(function (sock) {
      return sock.id !== socket.id;
    });
    socket.broadcast.emit('peer disconnected', session.user.screen_name);
  });

  /**
   * `send upgrade`: notify clients of an upgrade
   */
  socket.on('send upgrade', function () {
    socket.broadcast.emit('app upgraded');
  });

}

module.exports = function (app) {
  var redis = require('redis');
  var ioRedisStore = require('socket.io/lib/stores/redis');
  var io = socketio.listen(app);
  io.set('store', new ioRedisStore({
    redisPub : redis.createClient(),
    redisSub : redis.createClient(),
    redisClient : redis.createClient()
  }));
  io.set('log level', 0);
  io.set('heartbeat timeout', 30);
  io.set('heartbeat interval', 15);
  io.set('authorization', function (handshakeData, callback) {
    function denied() {
      console.log('yo you just got denied, bro');
      callback(null, false);
    }
    function accepted() { callback(null, true) }

    var headers = handshakeData.headers;
    var cookieString = headers.cookie;

    // if there's no cookie, there's no session.
    if (!cookieString) return denied();

    var cookies = parseCookie(cookieString);
    var sessionId = cookies['connect.sid'];

    // if there's no sessionId, how can we find the session?
    if (!sessionId) return denied();
    app.sessionStore.get(sessionId, function (err, session) {
      // deny without session
      if (!session) return denied();

      // if all that passes, set the session on the socket and accept
      handshakeData.session = session;
      accepted();
    });
    callback(null, true);
  })

  io.sockets.on('connection', function (socket) {
    setupListeners(socket, socket.handshake.session);
  });

  tweetStream.getStream(TWITTER_KEYWORDS, function (tweetDoc) {
    console.log(inspect(tweetDoc));
    io.sockets.emit('incoming tweet', tweetDoc);
  });

  setInterval(function () {
    io.sockets.emit('heartbeat');
  }, 10000);

  return io;
}

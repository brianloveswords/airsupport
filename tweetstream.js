var twitter = require('ntwitter');
var inspect = require('./utils.js').inspect;
var Tweet = require('./database.js').Tweet
var config = require('./config.json');

var TWITTER_CONSUMER_KEY = config.twitter_consumer_key;
var TWITTER_CONSUMER_SECRET = config.twitter_consumer_secret;
var TWITTER_ACCESS_TOKEN = config.twitter_access_token;
var TWITTER_ACCESS_TOKEN_SECRET = config.twitter_access_token_secret;

var twit = new twitter({
  consumer_key: TWITTER_CONSUMER_KEY,
  consumer_secret: TWITTER_CONSUMER_SECRET,
  access_token_key: TWITTER_ACCESS_TOKEN,
  access_token_secret: TWITTER_ACCESS_TOKEN_SECRET
});

function getStream(keyword, callback) {
  callback = callback || function () { };
  console.log(inspect(keyword));

  twit.stream('statuses/filter', {track: keyword}, function (stream) {
    stream.setMaxListeners(0);

    stream.on('data', function (tweetData) {
      if (tweetData.text.match(/^RT /)) return;

      console.log(inspect(tweetData));

      var tweet = new Tweet({
        user: tweetData.user.screen_name,
        createdAt: tweetData.created_at,
        text: tweetData.text,
        statusId: tweetData.id_str
      });

      tweet.save(function (err, thing) {
        // #TODO: handle errors
        if (err) return;
        callback(tweet);
      });
    });

    stream.on('error', function (err) {
      console.dir(err);
    });
  });
}
function prepopulate(keyword, callback) {
  callback = callback || function () { };
  var searchString = keyword.replace(/,/g, ' OR ');
  twit.search(searchString, { rpp: 100 }, function(err, data) {
    data.results.forEach(function (tweetData) {
      if (tweetData.text.match(/^RT /)) return;

      Tweet.findOne({ statusId: tweetData.id_str }, function (err, doc) {
        if (doc || err) return;
        var tweet = new Tweet({
          user: tweetData.from_user,
          createdAt: tweetData.created_at,
          text: tweetData.text,
          statusId: tweetData.id_str
        });
        tweet.save();
        callback(tweet);
      });

      console.log(inspect(tweetData));
    })
  });
}

exports.getStream = getStream;
exports.twitter = twit;

if (!module.parent) {
  var keywordList = 'mozparty,mozhelp,mozthimble,@mozilla,#supporttest';
  //prepopulate(keywordList);
  getStream(keywordList);
}
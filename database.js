var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var ObjectId = Schema.ObjectId;

var connection = mongoose.createConnection('localhost', 'tweethelp')
connection.on('error', function (err) {
  console.log('some sorta error');
  console.dir(err);
  process.exit(1);
});
connection.on('open', function () {
  console.log('database opened successfully');
});

var Reply = new Schema({
  date: Date,
  author: String,
  content: String,
  statusId: String
})


// when you add to this, make sure to add the corresponding field to
// static/js/app.js, `Tweet.fields` around line 50
var TweetSchema = new Schema({
  user: String,
  createdAt: Date,
  text: String,
  status: String,
  confirmed: Boolean,
  confirmedBy: String,
  closed: Boolean,
  closedBy: String,
  statusId: String,
  replies: [Reply],
  issues: String
});

var Tweet = connection.model('Tweet', TweetSchema);

exports.Tweet = Tweet;
exports.ObjectId = ObjectId;
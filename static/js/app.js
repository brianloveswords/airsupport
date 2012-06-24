!function (window, Ember, Handlebars, socket) {
  var App, Tweet;
  App = Ember.Application.create();

  //debugging
  window.App = App;

  Handlebars.registerHelper('humanDate', function (property) {
    var value = Ember.getPath(this, property);
    return new Date(value).toString().replace(/GMT.*$/, '');
  });

  Handlebars.registerHelper('linkify', function (property) {
    var value = Ember.getPath(this, property);

    value = value.replace(/(https?:\/\/[^ ]+)/g, function(match, one) {
      return '<a href="'+one+'" target="_blank">'+one+'</a>';
    });

    value = value.replace(/(#[^ ]+|@[^ ]+)/g, function (match, one) {
      return '<strong>'+one+'</strong>';
    });

    return new Handlebars.SafeString(value);
  });


  // Model definitions
  // ===================================================================
  Tweet = Ember.Object.extend({
    status: 'unconfirmed',
    closed: false,
    issues: [],
    replies: [],

    open: function () {
      return !this.get('closed');
    }.property('open'),

    hasReplies: function () {
      return this.get('replies').length > 0;
    }.property('replies'),

    retweeted: function () {
      return !!this.get('replies').filter(function (r) {
        return r.author === App.user.screen_name && r.retweet === true;
      }).length;
    }.property('replies'),

    confirm: function () {
      this.set('confirmed', true);
      this.set('confirmedBy', App.user.get('screen_name'));
    },

    values: function () {
      var fields = Tweet.fields;
      var accumulator = function(accum, f){
        accum[f] = this.get(f);
        return accum
      }.bind(this);
      return fields.reduce(accumulator, {});
    },

    sync: function (callback) {
      callback = callback || function () {}
      var data = this.values();
      socket.emit('send update', data, function (status) {
        if (status.error)
          return alert('there was some sort of error, please refresh');
        callback(status);
      });
    },

    destroy: function (callback) {
      callback = callback || function () {}
      var id = this.get('_id');
      socket.emit('destroy model', id, function (status) {
        if (status.error)
          return alert('there was some sort of error, please refresh');
        callback(status);
      });
    },

    update: function (newData) {
      var fields = Tweet.fields;
      fields.forEach(function (field) {
        this.set(field, newData[field]);
      }.bind(this));
    }
  });
  Tweet.fields = [
    '_id',
    'user',
    'createdAt',
    'text',
    'status',
    'confirmed',
    'confirmedBy',
    'closed',
    'closedBy',
    'statusId',
    'replies',
    'issues',
  ]
  Tweet.Collection = {}


  // View definitions
  // ===================================================================

  App.DetailsView = Ember.View.extend({
    templateName: 'tweet-details',
    classNameBindings: ['tweetTooLong', 'working', 'notModified', 'hasReplies', 'retweeted', 'model.closed'],

    working: false,

    notModified: true,

    hasRepliesBinding: 'model.hasReplies',

    retweetedBinding: 'model.retweeted',

    tweetTooLong: function () {
      if (this.get('remaining') < 1) return true;
      return false;
    }.property('remaining'),

    /**
     * helper: get/set the value of the outgoing tweet textarea
     */

    outgoingTweet: function (value) {
      if (value) return this.$('.outgoing-tweet').val(value)
      return this.$('.outgoing-tweet').val();
    },

    // events
    /**
     * count how many characters are remaining out of twitter's 140 max
     */

    countChars: function (event) {
      var $ = this.$.bind(this);
      var value = this.outgoingTweet();
      this.set('remaining', 140 - value.length);
      this.set('notModified', false);
    },

    stopBubble: function (event) { event.stopPropagation(); },

    /**
     * close the modal window
     */

    closeModal: function (event) { this.remove(); },

    /**
     * prepare a quote retweet
     */
    quoteRetweet: function (event) {
      var model = this.get('model');
      var user = model.get('user');
      var text = model.get('text');
      this.outgoingTweet(['RT', '@'+user, text].join(' '));
      this.countChars();
      this.$('.outgoing-tweet').focus();
    },

    /**
     * send a retweet
     */
    retweet: function (event, callback) {
      callback = callback || function () { }

      if (this.get('working') || this.get('retweeted')) return;
      this.set('working', true);

      var model = this.get('model');
      var msg = {
        for: model.values(),
        type: 'retweet'
      }

      model.get('replies').pushObject({
        author: App.user.screen_name,
        retweet: true
      });
      model.set('hasReplies', true);
      model.set('retweeted', true);

      console.log('sending retweet to socket');
      socket.emit('outgoing tweet', msg, function (response) {
        if (response.error)
          return alert('there was an error retweeting. try to refesh the page');
        console.log('retweet sent');
        model.update(response.doc);
        this.set('working', false);
        callback();
      }.bind(this));
    },

    /**
     * send a tweet and store as a reply on the model.
     * updates the client side before sending to the server,
     * then updates again with link to tweet upon success
     */

    sendTweet: function (event, callback) {
      callback = callback || function () { }

      // don't try to do anything if we're already working on sending a reply
      if (this.get('working') || this.get('tweetTooLong') || this.get('notModified')) return;
      this.set('working', true);

      var model = this.get('model');
      var msg = {
        outgoing: this.outgoingTweet().trim(),
        for: model.values()
      }

      // reset the default tweet
      this.outgoingTweet(this.defaultTweet);
      this.set('notModified', true);

      console.log('sending to socket');
      socket.emit('outgoing tweet', msg, function (response) {
        if (response.error)
          return alert('there was some sort of error and you should probably refresh');

        console.log('recieved response');
        model.update(response.doc);
        this.set('working', false);

        callback();
      }.bind(this));

      // update on the client while sending to the server
      model.get('replies').pushObject({
        author: App.user.screen_name,
        content: msg.outgoing,
      });
      model.set('hasReplies', true);
    },

    /**
     * send a tweet and close the issue.
     * waits for the model to sync, sends tweet and closes model on callback
     */

    sendTweetAndClose: function (event) {
      var model = this.get('model');
      model.set('closed', true);
      model.set('status', 'resolved');
      model.sync(function () {
        this.sendTweet(event, function () {
          this.closeModal();
        }.bind(this));
      }.bind(this));
      App.TweetViews[model.get('_id')].update();
    },

    /**
     * reopen an issue and confirm it
     */

    reopenIssue: function (event) {
      var model = this.get('model');
      model.set('closed', false);
      model.confirm();
      model.sync();
      App.TweetViews[model.get('_id')].update();
    },

    /**
     * close issue and mark as resolved
     */

    closeIssue: function (event) {
      var model = this.get('model');
      model.set('closed', true);
      model.sync();
      App.TweetViews[model.get('_id')].update();
    },
  });

  App.makeDetailsView = function (model) {
    var defaultTweet = '@' + model.get('user');
    var detailsView = App.DetailsView.create({
      defaultTweet: defaultTweet,
      model: model,
      remaining: 140 - defaultTweet.length,
    });
    detailsView.append();
    App.detailsView = detailsView;
  };

  // single tweet
  App.TweetView = Ember.View.extend({
    templateName: 'tweet',
    classNameBindings: ['model.confirmed', 'model.closed', 'dying'],
    dying: false,

    confirm: function (event) {
      var model = this.get('model')
      model.confirm();
      model.sync();
      this.update();
    },

    view: function (event) {
      var model = this.get('model');
      App.makeDetailsView(model);
    },

    update: function () {
      App.Containers.removeView(this);
      this.place();
      App.Containers.sort();
    },

    throwAway: function () {
      this.get('model').destroy();
      this.$().slideUp(function () {
        this.remove();
      }.bind(this));
    },

    place: function () {
      var incoming = App.Containers.incoming.get('childViews');
      var confirmed = App.Containers.confirmed.get('childViews');
      var closed = App.Containers.closed.get('childViews');

      var tweet = this.get('model');

      if (tweet.get('closed'))
        closed.pushObject(this);
      else if (tweet.get('confirmed'))
        confirmed.pushObject(this);
      else incoming.pushObject(this);
    }
  });
  App.TweetViews = {};

  App.BaseContainer = Ember.ContainerView.extend({
    childViews: [],
    _sort: function () {
      var views = this.get('childViews');
      views.sort(function (a, b) {
        var aDate = a.get('model').get('createdAt');
        var bDate = b.get('model').get('createdAt');
        if (aDate < bDate) return +1
        if (aDate > bDate) return -1
        return 0;
      });

    },
    _replace: function () {
      var views = this.get('childViews');
      views.forEach(function (view) {
        var el = view.$();
        $(this.parent).append(el);
      }.bind(this));
    },
    sort: function () {
      this._sort();
      this._replace();
    }
  });

  App.Containers = {
    incoming: App.BaseContainer.create({parent: '#incoming-container'}),
    confirmed: App.BaseContainer.create({
      parent: '#confirmed-container',
      sort: function () {
        this._sort();
        this.get('childViews').reverse();
        this._replace();
      }
    }),
    closed: App.BaseContainer.create({parent: '#closed-container'})
  };

  App.Containers.list = [
    App.Containers.incoming,
    App.Containers.confirmed,
    App.Containers.closed
  ];

  App.Containers.appendAll = function () {
    this.list.forEach(function (container) {
      container.appendTo(container.parent);
    });
  };
  App.Containers.removeView = function (view) {
    this.list.forEach(function (container) {
      container.get('childViews').removeObject(view);
    });
  };
  App.Containers.sort = function () {
    this.list.forEach(function (container) { container.sort() });
  }

  // App level actions
  // ===================================================================
  App.connectedUsers = Ember.Object.create({
    users: [],
    count: function () {
      return this.get('users').length
    }.property('users')
  });

  App.connectedUsersView = Ember.View.create({
    templateName: 'connected-users',
    model: App.connectedUsers,
    usersBinding: 'model.users',
    countBinding: 'model.count'
  });
  App.connectedUsersView.appendTo('#connected-users');


  App.initialize = function (response) {
    var session = response.session;
    var tweets = response.tweets;
    var users = response.users;
    var monitoring = response.monitoring;

    App.user = Ember.Object.create(session.user);
    App.connectedUsers.set('users', users);

    tweets.forEach(function (tweetData) {
      var tweet = Tweet.create(tweetData);
      var view = App.TweetView.create({ model: tweet });
      Tweet.Collection[tweet._id] = tweet;
      App.TweetViews[tweet._id] = view;
      view.place();
    });
    App.Containers.appendAll();
    App.Containers.sort();

    var monitoringView = Ember.View.create({
      templateName: 'monitoring',
      monitoring: monitoring.map(function (v) {
        return {keyword: v}
      })
    });
    monitoringView.appendTo('#monitoring');
  };

  App.update = function (tweetData) {
    var id = tweetData._id;
    if (!Tweet.Collection[id])
      return App.handleIncomingTweet(tweetData);

    var tweet = Tweet.Collection[id];
    var view = App.TweetViews[id];

    console.log('recieving update');

    tweet.update(tweetData);
    view.update();
  };

  App.handleTweetRemoved = function (id) {
    console.log('other client removed a tweet');
    console.log(id);
    var view = App.TweetViews[id];
    view.set('dying', true);
    setTimeout(function () {
      view.$().slideUp(function(){
        view.remove();
      });
    }, 1000);
  };

  App.handleIncomingTweet = function (tweetData) {
    console.log('incoming tweet');
    var id = tweetData._id;
    if (Tweet.Collection[id])
      return App.update(tweetData);

    console.log('creating new tweet entry');
    var tweet = Tweet.create(tweetData);

    console.log('creating new view');
    var view = App.TweetView.create({ model: tweet });

    Tweet.Collection[id] = tweet;
    App.TweetViews[id] = view;

    console.log('placing view');
    view.place();

    setTimeout(function () {
      App.Containers.sort();
    }, 200);
  };

  App.sendUpgrade = function () {
    socket.emit('send upgrade');
    App.upgraded();
  };
  App.upgraded = function () {
    $('.upgrade').slideDown();
  };


  socket.emit('init', App.initialize)
  socket.on('app upgraded', App.upgraded);
  socket.on('update', App.update);
  socket.on('tweet removed', App.handleTweetRemoved)
  socket.on('incoming tweet', App.handleIncomingTweet)
  socket.on('peer disconnected', function (screenName) {
    console.log('@' + screenName, 'disconnected');
    var remaining = App.connectedUsers.users.filter(function (u) {
      return u.screenName !== screenName;
    });
    App.connectedUsers.set('users', remaining);
  });

  socket.on('heartbeat', function () {
    $('.heart').addClass('beat')
    setTimeout(function () {
      $('.heart').removeClass('beat');
    }, 1200);
  });

  socket.on('peer connected', function (screenName) {
    console.log('@' + screenName, 'connected');
    var users = App.connectedUsers.get('users').slice();

    var exists = users.filter(function (u) {
      return u.screenName === screenName;
    });

    if (exists.length) return;

    users.push({ screenName: screenName });
    App.connectedUsers.set('users', users);
  });


  $('body').on('keyup', function (event) {
    if (event.keyCode !== 27) return;
    if (!App.detailsView) return;
    App.detailsView.closeModal();
  });

  $('button.close').tooltip({});
}(window, Ember, Handlebars, io.connect());

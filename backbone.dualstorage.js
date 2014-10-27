// Generated by CoffeeScript 1.8.0
(function() {
  var CONSOLE_TAG, eventNames, states, wrapError;

  CONSOLE_TAG = "backbone-dualStorage";

  states = {
    SYNCHRONIZED: 'SYNCHRONIZED',
    SYNCHRONIZING: 'SYNCHRONIZING',
    UPDATE_FAILED: 'UPDATE_FAILED',
    CREATE_FAILED: 'CREATE_FAILED',
    DELETE_FAILED: 'DELETE_FAILED'
  };

  eventNames = {
    LOCAL_SYNC_FAIL: 'LOCAL_SYNC_FAIL',
    LOCAL_SYNC_SUCCESS: 'LOCAL_SYNC_SUCCESS',
    REMOTE_SYNC_FAIL: 'REMOTE_SYNC_FAIL',
    REMOTE_SYNC_SUCCESS: 'REMOTE_SYNC_SUCCESS',
    SYNCHRONIZED: 'SYNCHRONIZED'
  };

  wrapError = function(model, options) {
    var error;
    error = options.error;
    return options.error = function(resp) {
      if (error) {
        error(model, resp, options);
      }
      return model.trigger('error', model, resp, options);
    };
  };

  Backbone.DualModel = Backbone.Model.extend({
    states: states,
    remoteIdAttribute: 'id',
    getUrlForSync: function(urlRoot, method) {
      var remoteId;
      remoteId = this.get(this.remoteIdAttribute);
      if (remoteId && (method === 'update' || method === 'delete')) {
        return "" + urlRoot + "/" + remoteId + "/";
      }
      return urlRoot;
    },
    isInSynchronizing: function() {
      return this.get('status') === this.states.SYNCHRONIZING;
    },
    isDelayed: function() {
      var _ref;
      return (_ref = this.get('status')) === this.states.DELETE_FAILED || _ref === this.states.UPDATE_FAILED;
    }
  });

  Backbone.IndexedDB.prototype.create = function(model, options) {
    var data;
    model.set('status', states.CREATE_FAILED);
    data = model.attributes;
    return this.store.put(data, (function(_this) {
      return function(insertedId) {
        data[_this.keyPath] = insertedId;
        return options.success(data);
      };
    })(this), options.error);
  };

  Backbone.IndexedDB.prototype.update = function(model, options) {
    var data;
    model.set('status', states.UPDATE_FAILED);
    data = model.attributes;
    return this.store.put(data, options.success, options.error);
  };

  Backbone.IndexedDB.prototype.getAll = function(options) {
    var data;
    data = [];
    return this.iterate(function(item) {
      if (item.status !== states.DELETE_FAILED) {
        return data.push(item);
      }
    }, {
      onEnd: function() {
        return options.success(data);
      }
    });
  };

  Backbone.IndexedDB.prototype.destroy = function(model, options) {
    var data;
    if (model.isNew()) {
      return false;
    }
    model.set('status', states.DELETE_FAILED);
    data = model.attributes;
    return this.store.put(data, options.success, options.error);
  };

  Backbone.DualCollection = Backbone.Collection.extend({
    states: states,
    eventNames: eventNames,
    getSyncMethodsByState: function(state) {
      var method;
      return method = (function() {
        switch (false) {
          case this.states.CREATE_FAILED !== state:
            return 'create';
          case this.states.UPDATE_FAILED !== state:
            return 'update';
          case this.states.DELETE_FAILED !== state:
            return 'delete';
        }
      }).call(this);
    },
    merge: function(newData) {
      return newData;
    },
    firstSync: function(options) {
      var event, fetchSuccess, originalSuccess, syncError, syncSuccess;
      if (options == null) {
        options = {};
      }
      originalSuccess = options.success || $.noop;
      event = _.extend({}, Backbone.Events);
      syncSuccess = (function(_this) {
        return function(response) {
          var data, method;
          data = _this.merge(_this.parse(response));
          event.trigger(_this.eventNames.REMOTE_SYNC_SUCCESS);
          method = options.reset ? 'reset' : 'set';
          _this[method](data, options);
          originalSuccess(_this, data, options);
          _this.trigger('sync', _this, data, options);
          return wrapError(_this, options);
        };
      })(this);
      syncError = (function(_this) {
        return function(error) {
          return event.trigger(_this.eventNames.REMOTE_SYNC_FAIL, error, options);
        };
      })(this);
      fetchSuccess = (function(_this) {
        return function(data) {
          options.success = syncSuccess;
          options.error = syncError;
          event.trigger(_this.eventNames.LOCAL_SYNC_SUCCESS, data);
          return Backbone.ajaxSync('read', _this, options);
        };
      })(this);
      this.fetch({
        success: fetchSuccess,
        error: function(error) {
          return event.trigger(this.eventNames.LOCAL_SYNC_FAIL, error);
        }
      });
      return event;
    },
    removeGarbage: function() {
      var deferred, idsForRemove, options, status;
      deferred = new $.Deferred();
      idsForRemove = [];
      status = this.states.SYNCHRONIZING;
      options = {
        onEnd: (function(_this) {
          return function() {
            return _this.indexedDB.removeBatch(idsForRemove, (function() {
              return deferred.resolve(arguments);
            }), (function() {
              return deferred.reject(arguments);
            }));
          };
        })(this)
      };
      this.indexedDB.iterate(function(data) {
        if (data.status === status) {
          return idsForRemove.push(data.local_id);
        }
      }, options);
      return deferred.promise();
    },
    _getDelayedData: function(status) {
      var data, deferred, keyRange, options;
      deferred = new $.Deferred();
      data = [];
      keyRange = this.indexedDB.makeKeyRange({
        lower: status,
        upper: status
      });
      options = {
        index: 'status',
        keyRange: keyRange,
        onEnd: function() {
          return deferred.resolve(data);
        }
      };
      this.indexedDB.iterate(function(item) {
        return data.push(item);
      }, options);
      return deferred.promise();
    },
    getDelayedData: function() {
      var created, deferred, deleted, updated;
      deferred = new $.Deferred();
      deleted = this._getDelayedData(this.states.DELETE_FAILED);
      created = this._getDelayedData(this.states.CREATE_FAILED);
      updated = this._getDelayedData(this.states.UPDATE_FAILED);
      $.when(deleted, created, updated).done(function(a, b, c) {
        return deferred.resolve(_.union(a, b, c));
      });
      return deferred.promise();
    },
    fullSync: function() {
      var deferred;
      deferred = new $.Deferred();
      this.getDelayedData().done((function(_this) {
        return function(delayedData) {
          var count, done;
          console.log(CONSOLE_TAG, 'fullsync', delayedData);
          count = 0;
          done = function() {
            count++;
            if (count === delayedData.length) {
              return Backbone.ajaxSync('read', _this, {
                success: function(response) {
                  var data;
                  data = _this.parse(response);
                  _this.set(data, {
                    silent: true
                  });
                  return _this.markAsSynchronizing(delayedData).done(_this.removeGarbage().done(function() {
                    return deferred.resolve();
                  }));
                },
                error: function() {
                  return deferred.reject();
                }
              });
            }
          };
          return _.each(delayedData, function(item) {
            var method, model;
            method = _this.getSyncMethodsByState(item.status);
            delete item.status;
            model = new _this.model(item);
            console.log(CONSOLE_TAG, 'full sync model', item, method);
            model.url = model.getUrlForSync(_.result(_this, 'url'), method);
            return Backbone.ajaxSync(method, model, {
              success: done,
              error: done
            });
          });
        };
      })(this));
      return deferred.promise();
    },
    save: function() {
      var deferred;
      deferred = new $.Deferred();
      this.indexedDB.saveAll((function() {
        return deferred.resolve();
      }), (function() {
        return deferred.reject();
      }));
      return deferred.promise();
    },
    markAsSynchronizing: function(delayedData) {
      var deferred, deferreds, map;
      deferred = new $.Deferred();
      map = (function(_this) {
        return function(item) {
          item.status = _this.states.SYNCHRONIZING;
          deferred = new $.Deferred();
          _this.indexedDB.store.put(item, (function() {
            return deferred.resolve();
          }), (function() {
            return deferred.reject();
          }));
          return deferred.promise();
        };
      })(this);
      console.log(CONSOLE_TAG, 'start to mark as synchronizing', delayedData);
      deferreds = _.map(delayedData, map);
      $.when.apply($, deferreds).done(function() {
        console.log(CONSOLE_TAG, 'mark successful', delayedData);
        return deferred.resolve(delayedData);
      }).fail(function() {
        return console.warn(CONSOLE_TAG, 'could not mark as sync', arguments);
      });
      return deferred.promise();
    }
  });

}).call(this);

//# sourceMappingURL=backbone.dualstorage.js.map

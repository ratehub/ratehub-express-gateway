const db = require('../../db');
const config = require('../../config');

const dao = {};
const userNamespace = 'user';
const usernameNamespace = 'username';

dao.insert = function (user) {
  // key for the user hash table
  const redisUserKey = config.systemConfig.db.redis.namespace.concat('-', userNamespace).concat(':', user.id);

  // name for the user's username set
  const redisUsernameSetKey = config.systemConfig.db.redis.namespace.concat('-', usernameNamespace).concat(':', user.username);
  return db
    .multi()
    .hmset(redisUserKey, user)
    .sadd(redisUsernameSetKey, user.id)
    .exec()
    .then(res => res.every(val => val));
};

dao.getUserById = function (userId) {
  return db.hgetall(config.systemConfig.db.redis.namespace.concat('-', userNamespace).concat(':', userId))
    .then(function (user) {
      if (!user || !Object.keys(user).length) {
        return false;
      }
      return user;
    });
};

dao.findAll = async function ({ start = 0, count = '100' } = {}) {
  const key = config.systemConfig.db.redis.namespace.concat('-', userNamespace).concat(':');
  const userKeys = [];
  let cursor = String(start);
  do {
    const [next, batch] = await db.scan(cursor, 'MATCH', `${key}*`, 'COUNT', count);
    cursor = next;
    if (batch && batch.length) userKeys.push(...batch);
  } while (cursor !== '0');
  if (userKeys.length === 0) return { users: [], nextKey: 0 };
  const users = await Promise.all(userKeys.map(k => db.hgetall(k)));
  return { users, nextKey: 0 };
};

dao.find = function (username) {
  return db.smembers(config.systemConfig.db.redis.namespace.concat('-', usernameNamespace).concat(':', username))
    .then(function (Ids) {
      if (Ids && Ids.length !== 0) {
        return Ids[0];
      } else return false;
    });
};

dao.update = function (userId, props) {
  // key for the user in redis
  const redisUserKey = config.systemConfig.db.redis.namespace.concat('-', userNamespace).concat(':', userId);
  return db
    .hmset(redisUserKey, props)
    .then(res => !!res);
};

dao.activate = function (id) {
  return db.hmset(config.systemConfig.db.redis.namespace.concat('-', userNamespace).concat(':', id), 'isActive', 'true', 'updatedAt', String(new Date()));
};

dao.deactivate = function (id) {
  return db.hmset(config.systemConfig.db.redis.namespace.concat('-', userNamespace).concat(':', id), 'isActive', 'false', 'updatedAt', String(new Date()));
};

dao.remove = function (userId) {
  return this.getUserById(userId)
    .then(function (user) {
      if (!user) {
        return false;
      }
      return db
        .multi()
        .del(config.systemConfig.db.redis.namespace.concat('-', userNamespace).concat(':', userId))
        .srem(config.systemConfig.db.redis.namespace.concat('-', usernameNamespace).concat(':', user.username), userId)
        .exec()
        .then(replies => replies.every(res => res));
    });
};

module.exports = dao;

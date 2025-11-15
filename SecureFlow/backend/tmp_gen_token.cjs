const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET || 'local_dev_secret';
const token = jwt.sign({ id: 'test', username: 'dev', email: 'dev@local' }, secret, { expiresIn: '1h' });
console.log(token);

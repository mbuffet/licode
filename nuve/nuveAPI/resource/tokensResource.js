/*global exports, require, Buffer*/
'use strict';
var tokenRegistry = require('./../mdb/tokenRegistry');
var serviceRegistry = require('./../mdb/serviceRegistry');
var dataBase = require('./../mdb/dataBase');
var crypto = require('crypto');
var cloudHandler = require('../cloudHandler');
var logger = require('./../logger').logger;

// Logger
var log = logger.getLogger('TokensResource');

var currentService;
var currentRoom;

/*
 * Gets the service and the room for the proccess of the request.
 */
var doInit = function (roomId, callback) {
    currentService = require('./../auth/nuveAuthenticator').service;

    serviceRegistry.getRoomForService(roomId, currentService, function (room) {
        //log.info(room);
        currentRoom = room;
        callback();
    });
};

var getTokenString = function (id, token) {
    var toSign = id + ',' + token.host,
        hex = crypto.createHmac('sha1', dataBase.nuveKey).update(toSign).digest('hex'),
        signed = (new Buffer(hex)).toString('base64'),

        tokenJ = {
            tokenId: id,
            host: token.host,
            secure: token.secure,
            signature: signed
        },
        tokenS = (new Buffer(JSON.stringify(tokenJ))).toString('base64');

    return tokenS;
};

/*
 * Generates new token.
 * The format of a token is:
 * {tokenId: id, host: erizoController host, signature: signature of the token};
 */
var generateToken = function (callback) {
    var user = require('./../auth/nuveAuthenticator').user,
        role = require('./../auth/nuveAuthenticator').role,
        r,
        tr,
        token,
        tokenS;

    if (user === undefined || user === '') {
        callback(undefined);
        return;
    }

    token = {};
    token.userName = user;
    token.room = currentRoom._id;
    token.role = role;
    token.service = currentService._id;
    token.creationDate = new Date();

    // Values to be filled from the erizoController
    token.secure = false;

    if (currentRoom.p2p) {
        token.p2p = true;
    }

    r = currentRoom._id;
    tr = undefined;

    if (currentService.testRoom !== undefined) {
        tr = currentService.testRoom._id;
    }

    if (tr === r) {

        if (currentService.testToken === undefined) {
            token.use = 0;
            token.host = dataBase.testErizoController;

            log.info('message: generateTestToken');

            tokenRegistry.addToken(token, function (id) {

                token._id = id;
                currentService.testToken = token;
                serviceRegistry.updateService(currentService);

                tokenS = getTokenString(id, token);
                callback(tokenS);
                return;
            });

        } else {

            token = currentService.testToken;

            log.info('message: generateTestToken already generated - returning, ' +
                logger.objectToLog(token));

            tokenS = getTokenString(token._id, token);
            callback(tokenS);
            return;

        }
    } else {

        cloudHandler.getErizoControllerForRoom(currentRoom, function (ec) {
            if (ec === 'timeout') {
                callback('error');
                return;
            }

            token.secure = ec.ssl;
            if (ec.hostname !== '') {
                token.host = ec.hostname;
            } else {
                token.host = ec.ip;
            }

            token.host += ':' + ec.port;

            tokenRegistry.addToken(token, function (id) {

                var tokenS = getTokenString(id, token);
                callback(tokenS);
            });
        });
    }
};

/*
 * Post Token. Creates a new token for a determined room of a service.
 */
exports.create = function (req, res) {
    doInit(req.params.room, function () {

        if (currentService === undefined) {
            log.warn('message: createToken - service not found');
            res.send('Service not found', 404);
            return;
        } else if (currentRoom === undefined) {
            log.warn('message: createToken - room not found, roomId: ' + req.params.room);
            res.send('Room does not exist', 404);
            return;
        }

        generateToken(function (tokenS) {

            if (tokenS === undefined) {
                res.status(401).send('Name and role?');
                return;
            }
            if (tokenS === 'error') {
                log.error('message: createToken error, errorMgs: No Erizo Controller available');
                res.status(404).send('No Erizo Controller found');
                return;
            }
            log.info('message: createToken success, roomId: ' + currentRoom._id +
                     ', serviceId: ' + currentService._id);
            res.send(tokenS);
        });
    });
};

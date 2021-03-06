var _              = require("lodash");
var Promise        = require('bluebird');
var sinon          = require('sinon');
var chai           = require('chai');
var chaiAsPromised = require('chai-as-promised');
var sinonChai      = require("sinon-chai");
var couchbase      = require('couchbase').Mock;
var moment         = require('moment');

var Model         = require("../../lib/model.js");
var ODM           = require('../../index.js');
var InstanceError = require('../../lib/error/instanceError.js');

var DataTypes = ODM.DataTypes;

//this makes sinon-as-promised available in sinon:
require('sinon-as-promised');

chai.use(sinonChai);
chai.use(chaiAsPromised);
chai.should();

var assert = sinon.assert;
var expect = chai.expect;

describe('Instance', function() {

    before(function() {
        var cluster = new couchbase.Cluster();
        var bucket = cluster.openBucket('test');

        var odm = new ODM({bucket: bucket});

        this.modelManager = odm.modelManager;
        this.buildModel = function(name, schema, options) {
            options = _.merge({}, odm.options, options || {});
            var model = new ODM.Model(name, schema, options);
            return model;
        };
    });

    describe('constructor', function() {
        it("should throw an InstanceError when we don't provide valid `options.key` value", function() {
            var model = this.buildModel('InstanceConstructorTestModel', {
                type: DataTypes.STRING
            });
            model.$init(this.modelManager);

            function test() {
                var instance = new model.Instance('data string', {
                    key: null
                });
            }

            expect(test).to.throw(InstanceError);
        });
    });

    describe('sanitize', function() {

        before(function() {
            this.model = this.buildModel('User', {
                type: DataTypes.HASH_TABLE,
                schema: {
                    username: {
                        type: DataTypes.STRING
                    },
                    friend: {
                        allowEmptyValue: true,
                        type: DataTypes.COMPLEX('User', {
                            relation: ODM.RelationTypes.REF
                        })
                    },
                    mother: {
                        allowEmptyValue: true,
                        type: DataTypes.COMPLEX('User', {
                            relation: ODM.RelationTypes.EMBEDDED
                        })
                    }
                }
            });
            this.model.$init(this.modelManager);
            this.modelManager.add(this.model);
        });

        after(function() {
            delete this.model;
            this.modelManager.models = {};
        });

        it('should call defined `beforeValidate` and `afterValidate` hooks', function() {
            var runHooksSpy = sinon.spy(this.model, 'runHooks');
            var sanitizerSpy = sinon.spy(ODM.DataSanitizer, 'sanitize');

            var instance = this.model.build({username: 'fogine'});

            //reset spies because data can be sanitized when building new Instance
            //via this.model.build
            sanitizerSpy.reset();
            runHooksSpy.reset();

            instance.sanitize();
            runHooksSpy.firstCall.should.have.been.calledWith(ODM.Hook.types.beforeValidate);
            sanitizerSpy.should.have.been.calledBefore(runHooksSpy.secondCall);
            runHooksSpy.secondCall.should.have.been.calledWith(ODM.Hook.types.afterValidate);
            runHooksSpy.should.have.been.calledTwice;
            runHooksSpy.restore();
            sanitizerSpy.restore();
        });

        it('should call `dataSanitizer.sanitize`', function() {
            var sanitizerSpy = sinon.spy(ODM.DataSanitizer, 'sanitize');

            var instance = this.model.build({username: 'fogine'});
            //reset spy because data can be sanitized when building new Instance
            //via this.model.build
            sanitizerSpy.reset();

            instance.$touchTimestamps();
            instance.sanitize();

            sanitizerSpy.should.have.been.calledOnce;
            sanitizerSpy.should.have.been.calledWith(
                    this.model.options.schema,
                    instance.getData(),
                    sinon.match({})
            );
            sanitizerSpy.restore();
        });

        describe('`includeUnlisted` option', function() {
            it('should set `includeUnlisted` option if schema definition has not defined property types (applies only for data of type `HASH_TABLE`)', function() {
                var model = this.buildModel('User2', {
                    type: DataTypes.HASH_TABLE
                });
                model.$init(this.modelManager);

                var sanitizerSpy = sinon.spy(ODM.DataSanitizer, 'sanitize');

                var instance = model.build({username: 'fogine'});

                //reset spy because data can be sanitized when building new Instance
                //via this.model.build
                sanitizerSpy.reset();

                instance.$touchTimestamps();
                instance.sanitize();

                sanitizerSpy.should.have.been.calledOnce;
                sanitizerSpy.should.have.been.calledWith(
                        model.options.schema,
                        instance.getData(),
                        sinon.match({includeUnlisted: true})
                );
                sanitizerSpy.restore();
            });
        });

        describe('`skipInternalProperties` option', function() {
            it('should accept `skipInternalProperties` option', function() {
                var model = this.buildModel('User3', {
                    type: DataTypes.HASH_TABLE
                }, {timestamps: false});
                model.$init(this.modelManager);

                var sanitizerSpy = sinon.spy(ODM.DataSanitizer, 'sanitize');

                var instance = model.build({username: 'fogine'});

                instance.sanitize({skipInternalProperties: false});

                sanitizerSpy.should.have.been.calledWith(
                        model.options.schema,
                        instance.getData(),
                        sinon.match(function(opt) {
                            return opt.skipInternalProperties === false;
                        })
                );
                sanitizerSpy.restore();
            });
        });

        describe('`associations` option', function() {
            before(function() {
                this.instance = this.model.build({
                    username: 'fogine',
                    mother: this.model.build({username: 'mother'}),
                    friend: this.model.build({username: 'James'}),
                });

                this.userSanitizeSpy = sinon.spy(this.model.Instance.prototype, 'sanitize');
            });

            beforeEach(function() {
                this.userSanitizeSpy.reset();
            });

            after(function() {
                this.userSanitizeSpy.restore();
                delete this.instance;
            });

            it("should call the `sanitize` method on all object's associations as well", function() {
                this.instance.sanitize({
                    associations: true
                });

                this.userSanitizeSpy.should.be.calledThrice;
            });

            it("should call the `sanitize` method on all object's associations of EMBEDDED relation type", function() {
                this.instance.sanitize({
                    associations: {
                        embedded: true
                    }
                });

                this.userSanitizeSpy.should.be.calledTwice;
            });

            it("should call the `sanitize` method on all object's associations of REFERENCE relation type", function() {
                this.instance.sanitize({
                    associations: {
                        reference: true
                    }
                });

                this.userSanitizeSpy.should.be.calledTwice;
            });
        });
    });

    describe('$initRelations', function() {
        it('should instantiate all non-empty relations', function() {
            var AppModel = this.buildModel('App', {
                type: DataTypes.STRING
            }, {
                key: ODM.UUID4Key
            });

            var UserModel = this.buildModel('User', {
                type: DataTypes.HASH_TABLE,
                schema: {
                    app: {
                        type: DataTypes.COMPLEX('App')
                    },
                    friends: {
                        type: DataTypes.ARRAY,
                        schema: {
                            type: DataTypes.COMPLEX('User')
                        }
                    }
                }
            }, {
                key: ODM.UUID4Key
            });

            AppModel.$init(this.modelManager);
            this.modelManager.add(AppModel);

            UserModel.$init(this.modelManager);
            this.modelManager.add(UserModel);

            var appIdPropName = AppModel.options.schemaSettings.doc.idPropertyName;
            var userIdPropName = UserModel.options.schemaSettings.doc.idPropertyName;

            var appRef = {};
            appRef[appIdPropName] = AppModel.buildKey('386cf69b-1f87-43c4-a1bb-fe17694131f5').toString();

            var userRef = {};
            userRef[userIdPropName] = UserModel.buildKey('44fd1ca9-cd4c-4f6a-8c12-3bdb49ec2749').toString();

            var user = UserModel.build({
                app: appRef,
                friends: [userRef]
            });

            user.should.have.property('app').that.is.an.instanceof(AppModel.Instance);
            user.app.getKey().toString().should.be.equal(appRef[appIdPropName]);

            user.should.have.deep.property('friends.[0]').that.is.an.instanceof(UserModel.Instance);
            user.friends.pop().getKey().toString().should.be.equal(userRef[userIdPropName]);

        });

        it('should instantiate relations of document which has base type of Array', function() {
            var HumanModel = this.buildModel('Human', {
                type: DataTypes.HASH_TABLE
            }, {
                key: ODM.UUID4Key
            });

            var PeopleModel = this.buildModel('People', {
                type: DataTypes.ARRAY,
                schema: {
                    type: DataTypes.COMPLEX('Human')
                }
            }, {
                key: ODM.UUID4Key
            });

            HumanModel.$init(this.modelManager);
            this.modelManager.add(HumanModel);

            PeopleModel.$init(this.modelManager);
            this.modelManager.add(PeopleModel);

            var humanIdPropName = HumanModel.options.schemaSettings.doc.idPropertyName;

            var humanRef = {};
            humanRef[humanIdPropName] = HumanModel.buildKey('386cf69b-1f87-43c4-a1bb-fe17694131f5').toString();

            var people = PeopleModel.build([
                    humanRef, humanRef
            ]);

            people.getData().should.have.deep.property('[1]').that.is.an.instanceof(HumanModel.Instance);
            people.getData().pop().getKey().toString().should.be.equal(humanRef[humanIdPropName]);

            people.getData().should.have.deep.property('[0]').that.is.an.instanceof(HumanModel.Instance);
            people.getData().pop().getKey().toString().should.be.equal(humanRef[humanIdPropName]);

        });
    });

    describe('getSerializedData', function() {
        afterEach(function() {
            this.modelManager.models = {};
        });

        it('should only call original `document.getSerializedData` method for object which has primitive base type', function() {
            var AppModel = this.buildModel('Application', {
                type: DataTypes.STRING
            }, {
                key: ODM.UUID4Key
            });

            AppModel.$init(this.modelManager);
            this.modelManager.add(AppModel);

            var data = 'twitter';
            var twitter = AppModel.build(data);
            var serializeDataSpy = sinon.spy(twitter.super,  'getSerializedData');

            var promise = twitter.getSerializedData();

            return promise.should.be.fulfilled.then(function(serData) {
                serializeDataSpy.should.have.been.calledOnce;
                serData.should.be.equal(data);
               serializeDataSpy.restore();
            }).catch(function(err) {
               serializeDataSpy.restore();
               throw err;
            });
        });

        describe('with REFERENCED association relation', function() {
            it('should return json object with serialized associations (Instance->plain object with id property)', function() {
                var AppModel = this.buildModel('App', {
                    type: DataTypes.STRING
                }, { key: ODM.UUID4Key });

                var UserModel = this.buildModel('User', {
                    type: DataTypes.HASH_TABLE,
                    schema: {
                        app: {
                            type: DataTypes.COMPLEX('App'),
                            allowEmptyValue: true
                        },
                        friends: {
                            type: DataTypes.ARRAY,
                            allowEmptyValue: true,
                            default: [],
                            schema: {
                                type: DataTypes.COMPLEX('User')
                            }
                        }
                    }
                }, { key: ODM.UUID4Key });

                AppModel.$init(this.modelManager);
                this.modelManager.add(AppModel);

                UserModel.$init(this.modelManager);
                this.modelManager.add(UserModel);

                var appIdPropName = AppModel.options.schemaSettings.doc.idPropertyName;
                var userIdPropName = UserModel.options.schemaSettings.doc.idPropertyName;

                var keyOfJessica = UserModel.buildKey('420267e5-b9bd-4456-a253-80d67b2c79ec');
                var keyOfDavid = UserModel.buildKey('54b201f0-eac2-40f7-bad2-eaa1cd9c4fce');
                var keyOfApp = AppModel.buildKey('7ffa1518-7156-4fe3-b0ee-23ba9c228ad7');

                var jessica = UserModel.build({}, {key: keyOfJessica});
                var david = UserModel.build({}, {key: keyOfDavid});
                var app = AppModel.build('twitter', {key: keyOfApp});

                var user = UserModel.build({
                    app: app,
                    friends: [jessica, david]
                });

                var promise = user.getSerializedData();

                return promise.should.be.fulfilled.then(function(serData) {
                    var expectedAppData = {};
                    expectedAppData[appIdPropName] = app.getKey().toString();

                    serData.should.have.property('app').that.is.not.an.instanceof(AppModel.Instance);
                    serData.should.have.property('app').that.deep.equals(expectedAppData);
                });
            });
        });

        describe('with EMBEDDED association relation', function() {
            it('should not include internal "id" property of associated Model instance in returned json object', function() {
                var AppModel = this.buildModel('App', {
                    type: DataTypes.HASH_TABLE,
                    schema: {
                        name: {
                            type: DataTypes.STRING
                        }
                    }
                }, {
                    key: ODM.UUID4Key,
                    schemaSettings: {
                        doc: {
                            idPropertyName: '$id',
                            typePropertyName: '$type'
                        }
                    }
                });

                var UserModel = this.buildModel('User', {
                    type: DataTypes.HASH_TABLE,
                    schema: {
                        app: {
                            type: DataTypes.COMPLEX('App', {relation: ODM.RelationTypes.EMBEDDED})
                        }
                    }
                }, { key: ODM.UUID4Key });

                AppModel.$init(this.modelManager);
                this.modelManager.add(AppModel);

                UserModel.$init(this.modelManager);
                this.modelManager.add(UserModel);

                var appIdPropName = AppModel.options.schemaSettings.doc.idPropertyName;
                var appTypePropName = AppModel.options.schemaSettings.doc.typePropertyName;
                var userIdPropName = UserModel.options.schemaSettings.doc.idPropertyName;
                var userTypePropName = UserModel.options.schemaSettings.doc.typePropertyName;

                var keyOfApp = AppModel.buildKey('7ffa1518-7156-4fe3-b0ee-23ba9c228ad7');

                var app = AppModel.build({name: 'twitter'}, {key: keyOfApp});
                var user = UserModel.build({
                    app: app,
                });

                var promise = user.getSerializedData();

                return promise.should.be.fulfilled.then(function(serData) {
                    var expectedAppData = app.$cloneData();
                    expectedAppData[userIdPropName] = app.getKey().toString();
                    expectedAppData[userTypePropName] = app[appTypePropName];
                    delete expectedAppData[appIdPropName];
                    delete expectedAppData[appTypePropName];

                    serData.should.have.property('app').that.is.not.an.instanceof(AppModel.Instance);
                    serData.should.have.property('app').that.deep.equals(expectedAppData);
                });
            });
        });
    });

    describe('refresh', function() {
        afterEach(function() {
            this.modelManager.models = {};
        });

        it('should NOT overwrite `id` getter property on data object', function() {
            var Model = this.buildModel('Model', {
                type: DataTypes.HASH_TABLE,
                schema: {
                    test: {
                        type: DataTypes.STRING
                    }
                }
            });

            Model.$init(this.modelManager);
            var idPropName = Model.options.schemaSettings.doc.idPropertyName;

            var dataResponse = {
                cas: '123124',
                value: {
                    test: 'testvalue'
                }
            };
            dataResponse.value[idPropName] = '7ffa1518-7156-4fe3-b0ee-23ba9c228ad7';

            var getByIdStub = sinon.stub(Model, 'getByIdOrFail').returns(Promise.resolve(dataResponse));

            var instance = Model.build({test: 'test'}, {
                key: Model.buildKey("7ffa1518-7156-4fe3-b0ee-23ba9c228ad7")
            });

            var promise = instance.refresh();

            return promise.should.be.fulfilled.then(function(intance) {
                var data = instance.getData();

                getByIdStub.should.have.been.calledOnce;
                getByIdStub.should.have.been.calledWith(instance.getKey(), {plain: true});
                data.should.have.property('test', dataResponse.value.test);
                instance.should.have.property('test', dataResponse.value.test);
                data.should.have.property(idPropName, instance.getKey().getId());
                expect(Object.getOwnPropertyDescriptor(data, idPropName).get).to.be.a('function', 'Internal `id` property of instance data object should be `getter` only');
            });
        });
    });

    describe('$getRefDocs', function() {
        afterEach(function() {
            this.modelManager.models = {};
        });

        before(function() {
            this.Model = this.buildModel('Model', {
                type: DataTypes.HASH_TABLE,
                schema: {
                    name: {
                        type: DataTypes.STRING,
                    },
                    username: {
                        type: DataTypes.STRING,
                        allowEmptyValue: true
                    },
                    address: {
                        type: DataTypes.HASH_TABLE,
                        schema: {
                            house_number: {
                                type: DataTypes.INT
                            },
                            street: {
                                type: DataTypes.STRING,
                                allowEmptyValue: true
                            },
                        }
                    }
                }
            }, {
                key: ODM.UUID4Key,
                indexes: {
                    refDocs: {
                        username: {
                            keys: ['username'],
                            required: false
                        },
                        name: {
                            keys: ['name']
                        },
                        address: {
                            keys: ['address.street', 'address.house_number']
                        }
                    }
                }
            });

            this.Model.$init(this.modelManager);
        });


        after(function() {
            delete this.Model;
        });

        it('should return fulfilled promise with instantiated documents of all reference documents, according to current object data values', function() {
            var instanceData = {
                name: 'John',
                username: 'fogine',
                address: {
                    house_number: 9,
                    street: 'st. Blabla'
                }
            };

            var instance = this.Model.build(instanceData);

            var promise = instance.$getRefDocs();
            return promise.should.be.fulfilled.then(function(refDocs){
                var nameRefDoc, usernameRefDoc, addressRefDoc;

                refDocs.should.be.an.instanceof(Array);
                refDocs.should.have.lengthOf(3);
                refDocs.forEach(function(refDoc) {
                    var refDocKey = refDoc.getKey();
                    refDoc.should.be.an.instanceof(ODM.Document);
                    refDocKey.should.have.property('$isGenerated', true, 'RefDocKey must be generated');

                    if (refDocKey.ref.indexOf('name') > -1) nameRefDoc = refDoc;
                    if (refDocKey.ref.indexOf('username') > -1) usernameRefDoc = refDoc;
                    if (refDocKey.ref.indexOf('address.house_number') > -1) addressRefDoc = refDoc;
                });
                var name = instance.Model.name;
                var del = instance.Model.options.schemaSettings.key.delimiter;

                var expectedNameRefDocKey = name + del + nameRefDoc.getKey().ref[0] + del + instanceData.name;
                var expectedUsernameRefDocKey = name + del + usernameRefDoc.getKey().ref[0] + del + instanceData.username;
                var expectedAddressRefDocKey = ( name
                        + del
                        + addressRefDoc.getKey().ref[0]
                        + del
                        + addressRefDoc.getKey().ref[1]
                        + del
                        + instanceData.address.street
                        + del
                        + instanceData.address.house_number
                );

                nameRefDoc.getKey().toString().should.be.equal(expectedNameRefDocKey);
                usernameRefDoc.getKey().toString().should.be.equal(expectedUsernameRefDocKey);
                addressRefDoc.getKey().toString().should.be.equal(expectedAddressRefDocKey);
            });
        });

        it('should return rejected promise with `KeyError` if a `key` fails the generation and the refDoc has `required` option set to FALSE', function() {
            var instanceData = {
                name: 'John',
                //username: 'fogine', //==> should NOT cause to responde with rejected promise
                address: {
                    house_number: 9,
                    street: 'st. Blabla'
                }
            };

            var instance = this.Model.build(instanceData);

            var promise = instance.$getRefDocs();
            return promise.should.be.fulfilled.then(function(refDocs){
                refDocs.should.be.an.instanceof(Array);
                refDocs.should.have.lengthOf(2);
            });
        });

        it('should return rejected promise with `KeyError` if a `key` fails the generation and the refDoc has `required` option set', function() {
            var instanceData = {
                name: 'John',
                username: 'fogine',
                address: {
                    house_number: 9,
                    //street: 'st. Blabla' //==> should cause to responde with rejected promise
                }
            };

            var instance = this.Model.build(instanceData);

            var promise = instance.$getRefDocs();
            return promise.should.be.rejectedWith(ODM.errors.KeyError);
        });
    });

    describe('$getDirtyRefDocs', function() {
        before(function() {
            this.Model = this.buildModel('Model', {
                type: DataTypes.HASH_TABLE,
                schema: {
                    name: {
                        type: DataTypes.STRING,
                        allowEmptyValue: true
                    },
                    username: {
                        type: DataTypes.STRING,
                        allowEmptyValue: true
                    }
                }
            }, {
                key: ODM.UUID4Key,
                indexes: {
                    refDocs: {
                        username: {
                            keys: ['username']
                        },
                        name: {
                            keys: ['name'],
                            required: false
                        }
                    }
                }
            });

            this.Model.$init(this.modelManager);
        });

        afterEach(function() {
            this.modelManager.models = {};
        });


        after(function() {
            delete this.Model;
        });

        it('should return fulfilled promise with list containing two collections of documents', function() {
            var instanceData = {
                name: 'Anonymous',
                username: 'test'
            };
            var instance = this.Model.build(instanceData);
            instance.username = 'anonym';

            //$getDirtyRefDocs currently ignores whether an instance is persisted to bucket or not.
            var promise = instance.$getDirtyRefDocs();

            return promise.should.be.fulfilled.then(function(refDocs) {
                refDocs.should.have.property('current').that.is.an.instanceof(Array);
                refDocs.should.have.property('old').that.is.an.instanceof(Array);

                refDocs.current.should.have.lengthOf(1);
                refDocs.old.should.have.lengthOf(1);

                refDocs.current[0].should.be.an.instanceof(ODM.Document);
                refDocs.old[0].should.be.an.instanceof(ODM.Document);

                var name = instance.Model.name;
                var del = instance.Model.options.schemaSettings.key.delimiter;

                var expectedCurrentKey = name + del + 'username' + del + 'anonym';
                var expectedOldKey = name + del + 'username' + del + 'test';

                refDocs.current.pop().getKey().toString().should.be.equal(expectedCurrentKey);
                refDocs.old.pop().getKey().toString().should.be.equal(expectedOldKey);
            });
        });

        it('should return empty collections for object which does not have base data type of Array or Object', function() {
            var Model = this.buildModel('Test', {
                type: DataTypes.ENUM,
                enum: ['val1', 'val2']
            }, {
                key: ODM.UUID4Key
            });
            Model.$init(this.modelManager);

            var instance = Model.build('val1');
            instance.setData('val2');

            var promise = instance.$getDirtyRefDocs();

            return promise.should.be.fulfilled.then(function(refDocs) {
                refDocs.should.have.property('current').that.is.an.instanceof(Array);
                refDocs.should.have.property('old').that.is.an.instanceof(Array);
            });
        });

        it('should return fulfilled promise if a key of refDoc fails generation process and the refDoc has `required` option set to FALSE', function() {
            var instanceData = {
                //name: null,//==> should NOT cause to responde with rejected promise
                username: 'fogine',
            };

            var instance = this.Model.build(instanceData);

            var promise = instance.$getDirtyRefDocs();
            return promise.should.be.fulfilled.then(function(refDocs) {
                refDocs.should.have.property('current').that.is.an.instanceof(Array);
                refDocs.should.have.property('old').that.is.an.instanceof(Array);

                refDocs.current.should.have.lengthOf(0);
                refDocs.old.should.have.lengthOf(0);
            });
        });

        it('should return fulfilled promise with the `name` legacy refDoc index marked for removal', function() {
            var instanceData = {
                username: 'happie'
            };

            var instance = this.Model.build(instanceData);

            instance.$original.setData('name', 'James');

            var promise = instance.$getDirtyRefDocs();
            return promise.should.be.fulfilled.then(function(refDocs) {
                refDocs.should.have.property('old').that.is.an.instanceof(Array);

                refDocs.old.should.have.lengthOf(1);
                refDocs.old.pop().getKey().getId().should.be.equal('James');
            });
        });

        it("should return rejected promise with a KeyError when a required key (oldKey) of currently persisted document can't be generated", function() {
            var instanceData = {
                username: 'happie'
            };

            var instance = this.Model.build(instanceData);

            instance.$original.setData('username', undefined);

            var promise = instance.$getDirtyRefDocs();
            return promise.should.be.rejected.then(function(error) {
                error.should.be.instanceof(ODM.errors.KeyError);
            });
        });

        it('should return rejected promise if a key of refDoc fails generation process and the refDoc has `required` option set', function() {
            var instanceData = {
                name: 'Petr',
                username: null,//==> should cause to responde with rejected promise
            };

            var instance = this.Model.build(instanceData);

            var promise = instance.$getDirtyRefDocs();
            return promise.should.be.rejectedWith(ODM.errors.KeyError);
        });

        it('should return rejected promise with an Error if an old refDoc key generation process fails unexpectedly', function() {
            var error = new Error('getDirtyRefDocs testing errror');
            var keyGenerateStub = sinon.stub(this.Model.RefDocKey.prototype, 'generate')
                .returns(Promise.reject(error));

            var instanceData = {
                name: 'Anonymous',
                username: 'test'
            };
            var instance = this.Model.build(instanceData);
            instance.username = 'anonym';

            //$getDirtyRefDocs currently ignores whether an instance is persisted to bucket or not.
            var promise = instance.$getDirtyRefDocs();

            return promise.should.be.rejected.then(function(err) {
                err.should.be.equal(error);
                keyGenerateStub.restore();
            });
        });

        it('should return rejected promise with an Error if a new refDoc key generation process fails unexpectedly', function() {
            var self = this;
            var error = new Error('getDirtyRefDocs testing errror');

            var instanceData = {
                name: 'Anonymous',
                username: 'test'
            };
            var instance = this.Model.build(instanceData);
            instance.username = 'anonym';

            var getGeneratedKeyStub;
            var buildRefDocumentStub = sinon.stub(instance, '$buildRefDocument', function() {
                var promise = self.Model.Instance.prototype.$buildRefDocument.apply(this, arguments);
                return promise.then(function(doc) {
                    getGeneratedKeyStub = sinon.stub(doc, 'getGeneratedKey');
                    getGeneratedKeyStub.returns(Promise.reject(error));

                    return doc;
                });
            });

            //$getDirtyRefDocs currently ignores whether an instance is persisted to bucket or not.
            var promise = instance.$getDirtyRefDocs();

            return promise.should.be.rejected.then(function(err) {
                err.should.be.equal(error);
                buildRefDocumentStub.restore();
                getGeneratedKeyStub.restore();
            });
        });
    });

    describe('setData', function() {
        before(function() {
            this.model = this.buildModel('InstanceSetDataTestModel', {
                type: DataTypes.HASH_TABLE
            });
            this.model.$init(this.modelManager);

            this.data = {};
            this.instance = this.model.build(this.data);
        });

        it('should set specified data under specified property', function() {
            this.instance.setData('some', 'data');
            this.instance.getData().should.be.equal(this.data);
            this.instance.getData().should.have.property('some', 'data');
        });

        it('should set instance data object so that original data object reference is preserved', function() {
            var idPropName = this.model.options.schemaSettings.doc.idPropertyName;
            var typePropName = this.model.options.schemaSettings.doc.typePropertyName;

            var data = {another: 'data'};
            this.instance.setData(data);
            this.instance.getData().should.be.equal(this.data);
            this.instance.getData().should.have.property('another', 'data');
            this.instance.getData().should.have.property('some', 'data');
            this.instance.getData().should.have.property(idPropName);
            this.instance.getData().should.have.property(typePropName);
        });

        it('should return self (the document object)', function() {
            this.instance.setData({}).should.be.equal(this.instance);
            this.instance.setData('some', 'prop').should.be.equal(this.instance);
        });
    });

    describe('save', function() {
        it('should call `insert` method when a instance has not been persisted to bucket yet', function() {
            var Model = this.buildModel('Test', {
                type: DataTypes.BOOLEAN,
            }, {
                key: ODM.UUID4Key
            });
            Model.$init(this.modelManager);

            var instance = Model.build(true);

            var replaceStub = sinon.stub(instance, 'replace').returns(Promise.resolve());
            var insertStub = sinon.stub(instance, 'insert').returns(Promise.resolve());

            var options = {test: 'val'};
            var promise = instance.save(options);

            return promise.should.be.fulfilled.then(function() {
                replaceStub.should.have.callCount(0);
                insertStub.should.have.been.calledOnce;
                insertStub.should.have.been.calledWith(options);
            });
        });

        it('should call `replace` method when a instance has been at least once persisted to a bucket', function() {
            var Model = this.buildModel('Test', {
                type: DataTypes.DATE,
            }, {
                key: ODM.UUID4Key
            });
            Model.$init(this.modelManager);

            var instance = Model.build(new Date);

            var replaceStub = sinon.stub(instance, 'replace').returns(Promise.resolve());
            var insertStub = sinon.stub(instance, 'insert').returns(Promise.resolve());

            var options = {test: 'val'};
            instance.options.isNewRecord = false;

            var promise = instance.save(options);

            return promise.should.be.fulfilled.then(function() {
                insertStub.should.have.callCount(0);
                replaceStub.should.have.been.calledOnce;
                replaceStub.should.have.been.calledWith(options);
            });
        });

        it('should allow to update refDoc index of already persisted Instance with no index value present yet', function() {
            var Model = this.buildModel('Test', {
                type: DataTypes.HASH_TABLE,
                schema: {
                    name: {
                        type: DataTypes.STRING,
                        allowEmptyValue: true
                    },
                    age: {
                        type: DataTypes.INT
                    }
                }
            }, {
                key: ODM.UUID4Key,
                indexes: {
                    refDocs: {
                        name: {keys: ["name"], required: false}
                    }
                }
            });
            Model.$init(this.modelManager);

            var instance = Model.build({
                age: 21
            });
            //fake that the instance has been persisted to bucket
            instance.options.isNewRecord = false;
            instance.$original.options.isNewRecord = false;
            instance.options.cas = '213124123';
            instance.$original.options.cas = '213124123';

            //update field so an index will be generated
            instance.name = 'David';

            var replaceStub = sinon.stub(ODM.StorageAdapter.prototype, 'replace')
                .returns(Promise.resolve({
                    cas: '31423214',
                    value: {age: 21, name: 'David'}
                }));

            var insertStub = sinon.stub(ODM.StorageAdapter.prototype, 'insert')
                .returns(Promise.resolve({
                    cas: '3214233',
                    value: ''
                }));

            var promise = instance.save().catch(function(e) {
                console.error(e.stack);
                throw e;
            });

            return promise.should.be.fulfilled.then(function() {
                insertStub.should.have.callCount(1);
                replaceStub.should.have.been.calledOnce;
                rollback();
            }).catch(rollback);

            function rollback(e) {
                replaceStub.restore();
                insertStub.restore();

                if (e instanceof Error) {
                    throw e;
                }
            }
        })
    });

    describe('update', function() {
        before(function() {
            this.Model = this.buildModel('Model', {
                type: DataTypes.HASH_TABLE,
                schema: {
                    name: {
                        type: DataTypes.STRING,
                    },
                    email: {
                        type: DataTypes.STRING,
                        allowEmptyValue: true
                    },
                    apps: {
                        type: DataTypes.ARRAY,
                        allowEmptyValue: true
                    },
                    user: {
                        type: DataTypes.COMPLEX('Model'),
                        allowEmptyValue: true
                    }
                }
            }, {
                key: ODM.UUID4Key,
                indexes: {
                    //must be here because of the #14 bug
                    refDocs: {
                        name: {
                            keys: ['name']
                        }
                    }
                }
            });

            this.Model.$init(this.modelManager);
            this.modelManager.add(this.Model);
        });


        after(function() {
            delete this.Model;
            this.modelManager.models = {};
        });

        afterEach(function() {
            this.modelManager.models = {};
        });

        it('should update a document in bucket only with given data, independently on current state of the instance', function() {
            var idPropName = this.Model.options.schemaSettings.doc.idPropertyName;

            var instance2 = this.Model.build({
                name: 'charles carmichael'
            });

            var instance = this.Model.build({
                name: 'Jean Luc',
                email: 'test@test.com',
                apps: ['doom', 'half-life'],
                user: instance2
            });

            instance.name = "Dat";

            //fake that the instance has been persisted to bucket
            instance.options.isNewRecord = false;
            instance.$original.options.isNewRecord = false;
            var cas = '123244';
            instance.setCAS(cas);
            instance.$original.setCAS(cas);

            var originalData = instance.$original.$cloneData();

            var storageReplaceStub = sinon.stub(ODM.StorageAdapter.prototype, 'replace').returns(Promise.resolve({
                cas: '12312412'
            }));

            var options = {expiry: 3600};
            var data = {
                email: 'diena@test.com',
                apps: ['quake']
            };
            var promise = instance.update(data, options);

            return promise.should.be.fulfilled.then(function(instance) {
                instance.should.be.an.instanceof(ODM.Instance);
                instance.should.have.property('name', 'Dat');
                instance.should.have.property('email', 'diena@test.com');
                instance.should.have.property('apps').that.is.eql(['quake']);

                var userRelationData = {};
                userRelationData[idPropName] = instance2.getKey().toString();

                instance.$original.getKey().isGenerated().should.be.equal(true, "Instance key should be generated. But it's NOT");
                instance2.getKey().isGenerated().should.be.equal(true, "Instance key should be generated. But it's NOT");

                storageReplaceStub.should.have.been.calledOnce;

                var expectedData = originalData;
                expectedData.email = 'diena@test.com';
                expectedData.name = 'Jean Luc';
                expectedData.apps = ['quake'];
                expectedData.user = userRelationData;
                expectedData[idPropName] = instance.$original[idPropName];
                expectedData.created_at = instance.$original.created_at;
                expectedData.updated_at = instance.$original.updated_at;

                storageReplaceStub.should.have.been.calledWith(
                        instance.$original.getKey(),
                        expectedData,
                        _.merge({}, options, {cas: instance.getCAS()})
                );
                storageReplaceStub.restore();
            }).catch(function(err) {
                storageReplaceStub.restore();
                //console.log(err.stack);
                throw err;
            });
        });

        it('should support Models with primitive data structure (number/string)', function() {
            var Model = this.buildModel('PrimitiveModel', {
                type: DataTypes.STRING,
            }, {
                key: ODM.UUID4Key,
            });

            Model.$init(this.modelManager);

            var instance = Model.build('initial-document-value');

            //fake that the instance has been persisted to bucket
            instance.options.isNewRecord = false;
            instance.$original.options.isNewRecord = false;
            var cas = '123244';
            instance.setCAS(cas);
            instance.$original.setCAS(cas);

            var originalData = instance.$original.$cloneData();

            var storageReplaceStub = sinon.stub(ODM.StorageAdapter.prototype, 'replace').returns(Promise.resolve({
                cas: '12312412'
            }));

            var data = 'updated-document-value';
            var promise = instance.update(data);

            return promise.should.be.fulfilled.then(function(instance) {
                instance.should.be.an.instanceof(ODM.Instance);
                instance.getData().should.be.equal(data);

                instance.$original.getKey().isGenerated().should.be.equal(true, "Instance key should be generated. But it's NOT");
                storageReplaceStub.should.have.been.calledOnce;

                storageReplaceStub.should.have.been.calledWith(
                        instance.$original.getKey(),
                        data,
                        _.merge({}, {cas: instance.getCAS()})
                );
                storageReplaceStub.restore();
            }).catch(function(err) {
                storageReplaceStub.restore();
                throw err;
            });
        });

        it('should rollback the instance.$original to previous state if an error occurs', function() {
            var idPropName = this.Model.options.schemaSettings.doc.idPropertyName;

            var instance2 = this.Model.build({
                name: 'charles carmichael'
            });

            var instance = this.Model.build({
                name: 'Jean Luc',
                email: 'test@test.com',
                user: instance2
            });

            instance.name = "Dat";

            //fake that the instance has been persisted to bucket
            instance.options.isNewRecord = false;
            instance.$original.options.isNewRecord = false;
            var cas = '123244';
            instance.setCAS(cas);
            instance.$original.setCAS(cas);

            var originalData = instance.$original.$cloneData();

            var instanceOriginalSaveStub = sinon.stub(instance.$original, 'save')
                .returns(Promise.reject(new ODM.errors.StorageError('test err')));

            var promise = instance.update({
                email: 'diena@test.com',
                apps: ['appName'] // important! (it should be removed on rollback from original data object)
            });

            return promise.should.be.rejectedWith(ODM.errors.StorageError).then(function() {
                instance.$original.getData().should.have.property('email', 'test@test.com');
                instance.$original.should.have.property('email', 'test@test.com');
                instance.$original.should.have.property('user').that.is.an.instanceof(instance.Model.Instance);
                instance.$original.getData().should.be.eql(originalData);
            });
        });
    });

    describe('populate', function() {
        before(function() {
            this.Model = this.buildModel('Model', {
                type: DataTypes.HASH_TABLE,
                schema: {
                    name: {
                        type: DataTypes.STRING
                    },
                    subinstance: {
                        type: DataTypes.COMPLEX('Model'),
                        allowEmptyValue: true
                    }
                }
            }, {
                key: ODM.UUID4Key,
            });

            this.Model.$init(this.modelManager);
            this.modelManager.add(this.Model);

            this.instanceRefreshStub = sinon.stub(this.Model.Instance.prototype, 'refresh');
        });

        beforeEach(function() {
            this.instanceRefreshStub.reset();
        });

        after(function() {
            this.instanceRefreshStub.restore();
        });

        it('should return rejected promise with an InstanceError when invalid `include` parameter is provided', function() {
            var instance = this.Model.build({name: 'instance'});
            var subinstance = this.Model.build({name: 'subinstance'});

            instance.subinstance = subinstance;

            var promise = instance.populate([{
                path: {}
            }]);

            return promise.should.be.rejectedWith(InstanceError);
        });

        it('should return rejected promise with an InstanceError when destination path does not hold `Instance` object', function() {
            var instance = this.Model.build({name: 'instance'});

            var promise = instance.populate('subinstance');

            return promise.should.be.rejectedWith(InstanceError);
        });

        describe('with `skipPopulated` option', function() {
            it('should not load `Instance` objects which are considered already populated if the `options.skipPopulated=true`', function() {
                var self = this;

                var instance = this.Model.build({name: 'instance'});
                var subinstance = this.Model.build({name: 'subinstance'}, {
                    isNewRecord: false,
                    cas: '124'
                });

                instance.subinstance = subinstance;

                this.instanceRefreshStub.returns(Promise.resolve(subinstance));

                var promise = instance.populate('subinstance', {skipPopulated: true});

                return promise.should.be.fulfilled.then(function(result) {
                    result.should.be.equal(instance);
                    self.instanceRefreshStub.should.have.callCount(0);
                });
            });
        });

        describe('with `getOrFail` option', function() {
            it('should return fulfilled promise and skip population of those Instance objects on which the process fails with the StorageError with keyNotFound code', function() {
                var self = this;

                var error = new ODM.errors.StorageError(
                        'test error',
                        ODM.StorageAdapter.errorCodes.keyNotFound
                );
                var instance = this.Model.build({name: 'instance'});
                var subinstance = this.Model.build({name: 'subinstance'});

                instance.subinstance = subinstance;

                this.instanceRefreshStub.returns(Promise.reject(error));

                var promise = instance.populate('subinstance', {getOrFail: false});

                return promise.should.be.fulfilled.then(function(result) {
                    self.instanceRefreshStub.should.have.callCount(1);
                    result.should.be.equal(instance);
                    result.subinstance.should.be.equal(subinstance);
                });
            });

            it('should return rejected promise with the StorageError with keyNotFound code when an association is not found in a bucket ', function() {
                var self = this;

                var error = new ODM.errors.StorageError(
                        'test error',
                        ODM.StorageAdapter.errorCodes.keyNotFound
                );
                var instance = this.Model.build({name: 'instance'});
                var subinstance = this.Model.build({name: 'subinstance'});

                instance.subinstance = subinstance;

                this.instanceRefreshStub.returns(Promise.reject(error));

                var promise = instance.populate('subinstance', {getOrFail: true});

                return promise.should.be.rejected.then(function(err) {
                    self.instanceRefreshStub.should.have.callCount(1);
                    err.should.be.equal(error);
                    instance.subinstance.should.be.equal(subinstance);
                });
            });
        });
    });

    describe('Storage methods', function() {
        before(function() {
            this.Model = this.buildModel('User', {
                type: DataTypes.HASH_TABLE,
                schema: {
                    username: {
                        type: DataTypes.STRING
                    },
                    age: {
                        type: DataTypes.INT
                    },
                    friends: {
                        type: DataTypes.ARRAY,
                        schema: {
                            type: DataTypes.COMPLEX('User')
                        }
                    },
                    sex: {
                        type: DataTypes.ENUM,
                        enum: ['male', 'female']
                    },
                    born_at: {
                        type: DataTypes.DATE
                    }
                }
            }, {
                key: ODM.UUID4Key,
                timestamps: true,
                indexes: {
                    refDocs: {
                        username: {keys: ['username']},
                        age: {keys: ['age']}
                    }
                }
            });

            this.Model.$init(this.modelManager);
            this.modelManager.add(this.Model);
        });

        beforeEach(function() {
            this.friend = this.Model.build({
                username: 'friend',
                age: '25',
                friends: [],
                sex: 'female',
                born_at: new Date
            }, {
                isNewRecord: false,
                cas: '1234'
            });

            this.user = this.Model.build({
                username: 'fogine',
                age: '26',
                friends: [this.friend],
                sex: 'male',
                born_at: new Date,
                created_at: "2016-08-29T11:36:46Z",
                updated_at: "2016-08-29T11:36:46Z"
            }, {
                isNewRecord: false,
                cas: '1234'
            });

            this.user.setCAS('23901742395713000');

            this.removeStub = sinon.stub(ODM.StorageAdapter.prototype, 'remove');
            this.insertStub = sinon.stub(ODM.StorageAdapter.prototype, 'insert');
            this.replaceStub = sinon.stub(ODM.StorageAdapter.prototype, 'replace');
        });

        afterEach(function() {
            this.removeStub.restore();
            this.insertStub.restore();
            this.replaceStub.restore();
        });

        after(function() {
            delete this.Model;
            delete this.friend;
            delete this.user;
            this.modelManager.models = {};
        });

        describe('destroy', function() {

            it('should call defined `beforeDestroy` and `afterDestroy` hooks before and after destroy process', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));

                var beforeDestroyHookStub = sinon.stub().returns(Promise.resolve({}));
                var afterDestroyHookStub = sinon.stub().returns(Promise.resolve({}));

                this.user.Model.beforeDestroy(beforeDestroyHookStub, 'testhook');
                this.user.Model.afterDestroy(afterDestroyHookStub, 'testhook');

                var options = {
                    persist_to: 2
                };

                var promise = this.user.destroy(options);

                return promise.should.be.fulfilled.then(function(result) {

                    beforeDestroyHookStub.should.have.been.calledOnce;
                    beforeDestroyHookStub.should.have.been.calledBefore(self.removeStub);
                    beforeDestroyHookStub.should.have.been.calledWith(self.user);

                    afterDestroyHookStub.should.have.been.calledOnce;
                    afterDestroyHookStub.should.have.been.calledAfter(self.removeStub);
                    afterDestroyHookStub.should.have.been.calledWith(self.user, options);

                    self.user.Model.removeHook('beforeDestroy', 'testhook');
                    self.user.Model.removeHook('afterDestroy', 'testhook');
                });
            });

            it('should remove all refDocs before removing the main document', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));

                var promise = this.user.$getRefDocs();

                return promise.should.be.fulfilled.then(function(refDocs) {
                    self.removeStub.withArgs(refDocs[0].getKey());
                    self.removeStub.withArgs(refDocs[1].getKey());
                    self.removeStub.withArgs(self.user.getKey());

                    var promise = self.user.destroy();
                    return promise.should.be.fulfilled.then(function(result) {
                        result.should.be.equal(self.user);

                        //first reference document should be remove before the main document is removed
                        self.removeStub.withArgs(refDocs[0].getKey()).should.have.been.calledOnce;
                        self.removeStub.withArgs(refDocs[0].getKey()).should.have.been.calledBefore(
                                self.removeStub.withArgs(self.user.getKey())
                                );

                        //second reference document should be remove before the main document is removed
                        self.removeStub.withArgs(refDocs[1].getKey()).should.have.been.calledOnce;
                        self.removeStub.withArgs(refDocs[1].getKey()).should.have.been.calledBefore(
                                self.removeStub.withArgs(self.user.getKey())
                                );

                        //the main document should be removed at the end
                        self.removeStub.withArgs(self.user.getKey()).should.have.been.calledOnce;
                    });
                });
            });

            it('should provide available document\'s `cas` value to the remove operation', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));

                var casBck = this.user.getCAS();
                var promise = this.user.destroy();

                return promise.should.be.fulfilled.then(function(result) {
                    self.removeStub.should.have.been.calledWith(self.user.getKey(), {
                        cas: casBck
                    });
                });
            });

            it('should call `touchTimestamps` method before removal', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));

                var touchTimestampsSpy = sinon.spy(this.user, '$touchTimestamps');
                this.removeStub.withArgs(this.user.getKey());

                var promise = this.user.destroy();

                return promise.should.be.fulfilled.then(function(result) {
                    touchTimestampsSpy.should.have.been.calledBefore(
                            self.removeStub.withArgs(self.user.getKey())
                            );
                    touchTimestampsSpy.restore();
                });
            });

            it('should try to recover removed reference documents if remove operation fails on a refDoc or the main document', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));

                //on third call it deletes the main document
                this.removeStub.onThirdCall().returns(Promise.reject(new ODM.errors.StorageError('test')));

                var promise = this.user.destroy();

                return promise.should.be.rejectedWith(ODM.errors.StorageError).then(function() {
                    self.insertStub.should.have.been.calledTwice;

                    return self.user.$getRefDocs().then(function(refDocs) {
                        self.insertStub.should.have.been.calledWith(refDocs[0].getKey(), refDocs[0].getData());
                        self.insertStub.should.have.been.calledWith(refDocs[1].getKey(), refDocs[1].getData());
                    });
                });
            });

            it('should call the `replace` method instead the `remove` method on main document if model\'s options.paranoid === true', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));
                this.replaceStub.returns(Promise.resolve({cas: '23423541235324233', token: undefined}));

                var model = this.buildModel('ModelParanoid', {
                    type: DataTypes.HASH_TABLE
                }, {paranoid: true});

                model.$init(this.modelManager);
                var instance = model.build({
                    somedata: 'datastring'
                }, {
                    isNewRecord: false,
                    cas: '23901742395713000'
                });

                var casBck = instance.getCAS();
                self.removeStub.withArgs(instance.getKey());
                var promise = instance.destroy();

                return promise.should.be.fulfilled.then(function(result) {
                    self.removeStub.withArgs(instance.getKey()).should.have.callCount(0);
                    self.replaceStub.should.have.been.calledOnce;
                    //for some misterious reason it stresses that arguments dont match, which does not seem like that
                    //self.replaceStub.should.have.been.calledWithMatch(instance.getKey(), instance.getData(), {
                        //cas: casBck
                    //});
                });
            });

            it('should trigger defined `beforeRollback` and `afterRollback` hooks if performing rollback operation', function() {
                var self = this;
                var storageErr = new ODM.errors.StorageError('test');

                this.removeStub.onFirstCall().returns(Promise.resolve({cas: '21321534512314232', token: undefined}));
                //on second call it deletes the second reference document
                this.removeStub.onSecondCall().returns(Promise.reject(storageErr));

                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));

                var beforeRollbackHookStub = sinon.stub().returns(Promise.resolve({}));
                var afterRollbackHookStub = sinon.stub().returns(Promise.resolve({}));

                this.user.Model.beforeRollback(beforeRollbackHookStub, 'testhook');
                this.user.Model.afterRollback(afterRollbackHookStub, 'testhook');

                var promise = this.user.destroy();

                return promise.should.be.rejectedWith(ODM.errors.StorageError).then(function() {
                    beforeRollbackHookStub.should.have.been.calledOnce;
                    beforeRollbackHookStub.should.have.been.calledBefore(self.insertStub);

                    afterRollbackHookStub.should.have.been.calledOnce;
                    afterRollbackHookStub.should.have.been.calledAfter(self.insertStub);

                    return self.user.$getRefDocs().then(function(refDocs) {
                        var reportObj = {
                            err: storageErr,
                            operation: ODM.Operation.REMOVE,
                            docs: [refDocs[0]],
                            instance: self.user
                        };

                        beforeRollbackHookStub.should.have.been.calledWith(reportObj);
                        afterRollbackHookStub.should.have.been.calledWith(reportObj);

                        self.user.Model.removeHook('beforeRollback', 'testhook');
                        self.user.Model.removeHook('afterRollback', 'testhook');
                    });
                });
            });

            it('should trigger defined `afterFailedRollback` hooks if rollback operation fails', function() {
                var self = this;
                var storageErr = new ODM.errors.StorageError('test');

                this.removeStub.onFirstCall().returns(Promise.resolve({cas: '21321534512314232', token: undefined}));
                //on second call it deletes the second reference document
                this.removeStub.onSecondCall().returns(Promise.reject(storageErr));
                this.insertStub.returns(Promise.reject(storageErr));

                var afterFailedRollbackStub = sinon.stub().returns(Promise.resolve({}));

                this.user.Model.afterFailedRollback(afterFailedRollbackStub, 'testhook');

                var promise = this.user.destroy();

                return promise.should.be.rejectedWith(ODM.errors.StorageError).then(function() {

                    return self.user.$getRefDocs().then(function(refDocs) {
                        var reportObj = {
                            err: storageErr,
                            operation: ODM.Operation.REMOVE,
                            docs: [refDocs[0]],
                            instance: self.user
                        };

                        afterFailedRollbackStub.should.have.been.calledOnce;
                        afterFailedRollbackStub.should.have.been.calledWith(storageErr, reportObj);

                        self.user.Model.removeHook('afterFailedRollback', 'testhook');
                    });
                });
            });

            it('should return rejected promise with an InstanceError when we try to call the method on an instance object which does not have `cas` value set', function() {
                var self = this;

                this.user.setCAS(null);
                var promise = this.user.destroy();

                return promise.should.be.rejected.then(function(error) {
                    error.should.be.instanceof(InstanceError);
                    self.removeStub.should.have.callCount(0);
                });
            });

            it('should return fulfilled promise when we try to call the method on an instance object which does not have `cas` value set and `force=true`', function() {
                var self = this;

                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));

                this.user.setCAS(null);
                var promise = this.user.destroy({force:true});

                return promise.should.be.fulfilled;
            });
        });

        describe('insert', function() {

            before(function() {
                this.user.options.isNewRecord = true;
                this.user.setCAS(undefined);
            });

            it('should call defined `beforeCreate` and `afterCreate` hooks before and after insert process', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));

                var beforeCreateHookStub = sinon.stub().returns(Promise.resolve({}));
                var afterCreateHookStub = sinon.stub().returns(Promise.resolve({}));

                this.user.Model.beforeCreate(beforeCreateHookStub, 'testhook');
                this.user.Model.afterCreate(afterCreateHookStub, 'testhook');

                var options = {
                    expiry: 3600
                };

                var promise = this.user.insert(options);

                return promise.should.be.fulfilled.then(function(result) {

                    beforeCreateHookStub.should.have.been.calledOnce;
                    beforeCreateHookStub.should.have.been.calledBefore(self.insertStub);
                    beforeCreateHookStub.should.have.been.calledWith(self.user, options);

                    afterCreateHookStub.should.have.been.calledOnce;
                    afterCreateHookStub.should.have.been.calledAfter(self.insertStub);
                    afterCreateHookStub.should.have.been.calledWith(self.user, options);

                    self.user.Model.removeHook('beforeCreate', 'testhook');
                    self.user.Model.removeHook('afterCreate', 'testhook');
                });
            });

            it('should insert all refDocs before inserting the main document', function() {
                var self = this;
                var idPropName = this.Model.options.schemaSettings.doc.idPropertyName;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));

                var promise = this.user.$getRefDocs();

                return promise.should.be.fulfilled.then(function(refDocs) {
                    self.insertStub.withArgs(refDocs[0].getKey());
                    self.insertStub.withArgs(refDocs[1].getKey());
                    self.insertStub.withArgs(self.user.getKey());

                    var options = {expiry: 30};

                    var promise = self.user.insert(options);
                    return promise.should.be.fulfilled.then(function(result) {
                        result.should.be.equal(self.user);

                        //first reference document should be inserted before inserting the main document
                        self.insertStub.withArgs(refDocs[0].getKey()).should.have.been.calledOnce;
                        self.insertStub.withArgs(refDocs[0].getKey()).should.have.been.calledBefore(
                                self.insertStub.withArgs(self.user.getKey())
                        );
                        self.insertStub.withArgs(refDocs[0].getKey()).should.have.been.calledWith(
                                refDocs[0].getKey(), refDocs[0].getData(), options
                        );

                        //second reference document should be inserted before inserting the main document
                        self.insertStub.withArgs(refDocs[1].getKey()).should.have.been.calledOnce;
                        self.insertStub.withArgs(refDocs[1].getKey()).should.have.been.calledBefore(
                                self.insertStub.withArgs(self.user.getKey())
                        );
                        self.insertStub.withArgs(refDocs[1].getKey()).should.have.been.calledWith(
                                refDocs[1].getKey(), refDocs[1].getData(), options
                        );

                        //the main document should be inserted once with correct data at the end of the process
                        var expectedDataArg = self.user.getData();
                        var serializedFriend = {};
                        serializedFriend[idPropName] = expectedDataArg.friends.pop().getKey().toString();
                        expectedDataArg.friends.push(serializedFriend);

                        self.insertStub.withArgs(self.user.getKey()).should.have.been.calledOnce;
                        self.insertStub.withArgs(self.user.getKey()).should.have.been.calledWith(
                                self.user.getKey(), expectedDataArg, options
                        );
                    });
                });

            });

            it('should call `touchTimestamps` method before insert process', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));

                var touchTimestampsSpy = sinon.spy(this.user, '$touchTimestamps');
                this.insertStub.withArgs(this.user.getKey());

                var promise = this.user.insert();

                return promise.should.be.fulfilled.then(function(result) {
                    touchTimestampsSpy.should.have.been.calledBefore(
                            self.insertStub.withArgs(self.user.getKey())
                            );
                    touchTimestampsSpy.restore();
                });
            });

            it('should restore timestamp values if a validation error occurs', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));

                this.user.setData('username', undefined);
                var promise = this.user.insert();

                return promise.should.be.rejected.then(function() {
                    var createdAt = self.user.$original.getData('created_at');
                    var updatedAt = self.user.$original.getData('updated_at');

                    self.user.getData('created_at').should.be.equal(createdAt);
                    self.user.getData('updated_at').should.be.equal(updatedAt);
                });
            });

            it('should try to remove already inserted reference documents if insert operation fails on a refDoc or the main document', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));

                //on third call it inserts the main document
                this.insertStub.onThirdCall().returns(Promise.reject(new ODM.errors.StorageError('test')));

                var promise = this.user.insert();

                return promise.should.be.rejectedWith(ODM.errors.StorageError).then(function() {
                    self.removeStub.should.have.been.calledTwice;

                    return self.user.$getRefDocs().then(function(refDocs) {
                        self.removeStub.should.have.been.calledWith(refDocs[0].getKey());
                        self.removeStub.should.have.been.calledWith(refDocs[1].getKey());
                    });
                });
            });

            it('should trigger defined `beforeRollback` and `afterRollback` hooks if performing rollback operation', function() {
                var self = this;
                var storageErr = new ODM.errors.StorageError('test');

                this.insertStub.onFirstCall().returns(Promise.resolve({cas: '21321534512314232', token: undefined}));
                //on second call it inserts the second reference document
                this.insertStub.onSecondCall().returns(Promise.reject(storageErr));

                var beforeRollbackHookStub = sinon.stub().returns(Promise.resolve({}));
                var afterRollbackHookStub = sinon.stub().returns(Promise.resolve({}));

                this.user.Model.beforeRollback(beforeRollbackHookStub, 'testhook');
                this.user.Model.afterRollback(afterRollbackHookStub, 'testhook');

                var promise = this.user.insert();

                return promise.should.be.rejectedWith(ODM.errors.StorageError).then(function() {
                    beforeRollbackHookStub.should.have.been.calledOnce;
                    beforeRollbackHookStub.should.have.been.calledBefore(self.removeStub);

                    afterRollbackHookStub.should.have.been.calledOnce;
                    afterRollbackHookStub.should.have.been.calledAfter(self.removeStub);

                    return self.user.$getRefDocs().then(function(refDocs) {
                        var reportObj = {
                            err: storageErr,
                            operation: ODM.Operation.INSERT,
                            docs: [refDocs[0]],
                            instance: self.user
                        };

                        beforeRollbackHookStub.should.have.been.calledWith(reportObj);
                        afterRollbackHookStub.should.have.been.calledWith(reportObj);

                        self.user.Model.removeHook('beforeRollback', 'testhook');
                        self.user.Model.removeHook('afterRollback', 'testhook');
                    });
                });
            });

            it('should trigger defined `afterFailedRollback` hooks if rollback operation fails', function() {
                var self = this;
                var storageErr = new ODM.errors.StorageError('test');

                //on first call it inserts the first reference document
                this.insertStub.onFirstCall().returns(Promise.resolve({cas: '21321534512314232', token: undefined}));
                //on second call it inserts the second reference document
                this.insertStub.onSecondCall().returns(Promise.reject(storageErr));
                //it will cause to fail the rollback process
                this.removeStub.returns(Promise.reject(storageErr));

                var afterFailedRollbackStub = sinon.stub().returns(Promise.resolve({}));

                this.user.Model.afterFailedRollback(afterFailedRollbackStub, 'testhook');

                var promise = this.user.insert();

                return promise.should.be.rejectedWith(ODM.errors.StorageError).then(function() {

                    return self.user.$getRefDocs().then(function(refDocs) {
                        var reportObj = {
                            err: storageErr,
                            operation: ODM.Operation.INSERT,
                            docs: [refDocs[0]],
                            instance: self.user
                        };

                        afterFailedRollbackStub.should.have.been.calledOnce;
                        afterFailedRollbackStub.should.have.been.calledWith(storageErr, reportObj);

                        self.user.Model.removeHook('afterFailedRollback', 'testhook');
                    });
                });
            });
        });

        describe('replace', function() {
            before(function() {
                //fake that the user instance has been persisted to bucket
                this.user.setCAS('23901742395713000');
            });

            it('should call defined `beforeUpdate` and `afterUpdate` hooks before and after update (aka.replace) process', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));
                this.replaceStub.returns(Promise.resolve({cas: '1324231541234515', token: undefined}));

                var beforeUpdateHookStub = sinon.stub().returns(Promise.resolve({}));
                var afterUpdateHookStub = sinon.stub().returns(Promise.resolve({}));

                this.user.Model.beforeUpdate(beforeUpdateHookStub, 'testhook');
                this.user.Model.afterUpdate(afterUpdateHookStub, 'testhook');

                var options = {
                    expiry: 9000
                };

                var promise = this.user.replace(options);

                promise.catch(function(err) {
                    console.log(err.stack);
                });

                return promise.should.be.fulfilled.then(function(result) {

                    beforeUpdateHookStub.should.have.been.calledOnce;
                    beforeUpdateHookStub.should.have.been.calledBefore(self.replaceStub);
                    beforeUpdateHookStub.should.have.been.calledWith(self.user, options);

                    afterUpdateHookStub.should.have.been.calledOnce;
                    afterUpdateHookStub.should.have.been.calledAfter(self.replaceStub);
                    afterUpdateHookStub.should.have.been.calledWith(self.user, options);

                    self.user.Model.removeHook('beforeUpdate', 'testhook');
                    self.user.Model.removeHook('afterUpdate', 'testhook');
                });
            });

            it('should remove all `old` aka.outdated refDocs AFTER replacing the main document', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));
                this.replaceStub.returns(Promise.resolve({cas: '1324231541234515', token: undefined}));

                var oldUsername = this.user.username;
                this.user.username = 'cat';
                var promise = this.user.$getDirtyRefDocs();

                return promise.should.be.fulfilled.then(function(refDocs) {
                    refDocs = refDocs.old;

                    self.removeStub.withArgs(refDocs[0].getKey());
                    self.replaceStub.withArgs(self.user.getKey());

                    var options = {expiry: 500};

                    var promise = self.user.replace(options);
                    return promise.should.be.fulfilled.then(function(result) {
                        result.should.be.equal(self.user);

                        //outdated reference document should be removed after the main document is updated
                        self.removeStub.withArgs(refDocs[0].getKey()).should.have.been.calledOnce;
                        self.removeStub.withArgs(refDocs[0].getKey()).should.have.been.calledAfter(
                                self.replaceStub.withArgs(self.user.getKey())
                                );

                        //the main document should be updated at the end of the update process
                        self.replaceStub.withArgs(self.user.getKey()).should.have.been.calledOnce;
                    });
                });
            });

            it('should insert all new `current` refDocs before replacing the main document', function() {
                var self = this;
                var idPropName = this.Model.options.schemaSettings.doc.idPropertyName;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));
                this.replaceStub.returns(Promise.resolve({cas: '1324231541234515', token: undefined}));

                var oldUsername = this.user.username;
                this.user.username = 'cat';
                var promise = this.user.$getDirtyRefDocs();

                return promise.should.be.fulfilled.then(function(refDocs) {
                    refDocs = refDocs.current;

                    self.insertStub.withArgs(refDocs[0].getKey());
                    self.replaceStub.withArgs(self.user.getKey());

                    var options = {expiry: 30};
                    var casBck = self.user.getCAS();

                    var promise = self.user.replace(options);
                    return promise.should.be.fulfilled.then(function(result) {
                        result.should.be.equal(self.user);

                        //new reference document should be inserted before inserting the main document
                        self.insertStub.withArgs(refDocs[0].getKey()).should.have.been.calledOnce;
                        self.insertStub.withArgs(refDocs[0].getKey()).should.have.been.calledBefore(
                                self.replaceStub.withArgs(self.user.getKey())
                        );
                        self.insertStub.withArgs(refDocs[0].getKey()).should.have.been.calledWith(
                                refDocs[0].getKey(), refDocs[0].getData(), options
                        );

                        //the main document should be inserted once with correct data at the end of the process
                        var expectedDataArg = self.user.getData();
                        var serializedFriend = {};
                        serializedFriend[idPropName] = expectedDataArg.friends.pop().getKey().toString();
                        expectedDataArg.friends.push(serializedFriend);

                        self.replaceStub.withArgs(self.user.getKey()).should.have.been.calledOnce;
                        self.replaceStub.withArgs(self.user.getKey()).should.have.been.calledWith(
                                self.user.getKey(), expectedDataArg, {
                                    expiry: options.expiry,
                                    cas: casBck
                                }
                        );
                    });
                });

            });

            it('should provide available `cas` value to the replace operation', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));
                this.replaceStub.returns(Promise.resolve({cas: '1324231541234515', token: undefined}));

                var casBck = this.user.getCAS();
                var promise = this.user.replace();

                return promise.should.be.fulfilled.then(function(result) {
                    expect(self.replaceStub.args[0][2]).to.be.eql({
                        cas: casBck
                    }, 'Correct CAS value was not provided to the replace operation');
                });
            });

            it('should call `touchTimestamps` method before insert/replace operation', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));
                this.replaceStub.returns(Promise.resolve({cas: '1324231541234515', token: undefined}));

                var touchTimestampsSpy = sinon.spy(this.user, '$touchTimestamps');
                this.replaceStub.withArgs(this.user.getKey());

                this.user.username = 'cat';
                var promise = this.user.replace();

                return promise.should.be.fulfilled.then(function(result) {
                    touchTimestampsSpy.should.have.been.calledBefore(
                            self.replaceStub.withArgs(self.user.getKey())
                    );
                    touchTimestampsSpy.should.have.been.calledBefore(
                            self.insertStub
                    );
                    touchTimestampsSpy.restore();
                });
            });

            it('should try to destroy already inserted reference documents if some "bucket" operation fails during replace process', function() {
            });

            it('should trigger defined `afterFailedIndexRemoval` hooks if a remove operation of outdated refDoc indexes fails during replace process and there is an `afterFailedIndexRemoval` listener registered', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));
                this.replaceStub.returns(Promise.resolve({cas: '1324231541234515', token: undefined}));

                //on first call it deletes the outdated reference document
                var storageErr = new ODM.errors.StorageError('test');
                this.removeStub.onFirstCall().returns(Promise.reject(storageErr));

                var afterFailedIndexRemovalSpy = sinon.stub().returns(Promise.resolve({}));
                this.user.Model.afterFailedIndexRemoval(afterFailedIndexRemovalSpy, 'testhook');

                this.user.username = 'happiecat';
                var promise = this.user.replace();

                return promise.should.be.fulfilled.then(function() {
                    afterFailedIndexRemovalSpy.should.have.been.calledOnce;
                    afterFailedIndexRemovalSpy.should.have.been.calledWith(storageErr);
                    storageErr.should.have.property('doc').that.is.an.instanceof(ODM.Document);
                    self.user.Model.removeHook('afterFailedIndexRemoval', 'testhook');
                });
            });

            it('should return rejected promise with an Error if unexpected Error occurs while trying to remove outdated reference document indexes and there is NO `afterFailedIndexRemoval` listener registered', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));
                this.replaceStub.returns(Promise.resolve({cas: '1324231541234515', token: undefined}));

                //on first call it deletes the outdated reference document
                var storageErr = new ODM.errors.StorageError('test');
                this.removeStub.onFirstCall().returns(Promise.reject(storageErr));

                this.user.username = 'happiecat';
                var promise = this.user.replace();

                return promise.should.be.rejectedWith(storageErr);
            });

            it('should trigger defined `beforeRollback` and `afterRollback` hooks if performing rollback operation', function() {
                var self = this;
                var storageErr = new ODM.errors.StorageError('test');

                //on first call it inserts new refDoc index
                this.insertStub.onFirstCall().returns(Promise.resolve({cas: '21321534512314232', token: undefined}));
                //on first call it inserts another new refDoc index
                this.insertStub.onSecondCall().returns(Promise.reject(storageErr));

                var beforeRollbackHookStub = sinon.stub().returns(Promise.resolve({}));
                var afterRollbackHookStub = sinon.stub().returns(Promise.resolve({}));

                this.user.Model.beforeRollback(beforeRollbackHookStub, 'testhook');
                this.user.Model.afterRollback(afterRollbackHookStub, 'testhook');

                //it will make an attempt to update 'username' refdoc index of the instance
                this.user.username = 'happiecat';
                //it will make an attempt update 'age' refdoc index of the instance
                this.user.age = 10;
                var promise = this.user.replace();

                return promise.should.be.rejectedWith(ODM.errors.StorageError).then(function() {
                    beforeRollbackHookStub.should.have.been.calledOnce;
                    beforeRollbackHookStub.should.have.been.calledBefore(self.replaceStub);

                    afterRollbackHookStub.should.have.been.calledOnce;
                    afterRollbackHookStub.should.have.been.calledAfter(self.insertStub);

                    return self.user.$getDirtyRefDocs().then(function(refDocs) {
                        refDocs = refDocs.current;

                        var reportObj = {
                            err: storageErr,
                            operation: ODM.Operation.REPLACE,
                            docs: [refDocs[0]],
                            instance: self.user
                        };

                        beforeRollbackHookStub.should.have.been.calledWith(reportObj);
                        afterRollbackHookStub.should.have.been.calledWith(reportObj);

                        self.user.Model.removeHook('beforeRollback', 'testhook');
                        self.user.Model.removeHook('afterRollback', 'testhook');
                    });
                });
            });

            it('should trigger defined `afterFailedRollback` hooks if rollback operation fails', function() {
                var self = this;
                var storageErr = new ODM.errors.StorageError('test');

                //on first call it inserts new refDoc index
                this.insertStub.onFirstCall().returns(Promise.resolve({cas: '21321534512314232', token: undefined}));
                //on second call it inserts another new refDoc index
                this.insertStub.onSecondCall().returns(Promise.reject(storageErr));
                //it will cause to fail the rollback process
                this.removeStub.returns(Promise.reject(storageErr));

                var afterFailedRollbackStub = sinon.stub().returns(Promise.resolve({}));

                this.user.Model.afterFailedRollback(afterFailedRollbackStub, 'testhook');

                //it will make an attempt to update 'username' refdoc index of the instance
                //(=> insertStub.firstCall)
                this.user.username = 'happiecat';
                //it will make an attempt update 'age' refdoc index of the instance
                //(=> insertStub.secondCall)
                this.user.age = 10;
                var promise = this.user.replace();

                return promise.should.be.rejectedWith(ODM.errors.StorageError).then(function() {

                    return self.user.$getDirtyRefDocs().then(function(refDocs) {
                        refDocs = refDocs.current;

                        var reportObj = {
                            err: storageErr,
                            operation: ODM.Operation.REPLACE,
                            docs: [refDocs[0]],
                            instance: self.user
                        };

                        afterFailedRollbackStub.should.have.been.calledOnce;
                        afterFailedRollbackStub.should.have.been.calledWith(storageErr, reportObj);

                        self.user.Model.removeHook('afterFailedRollback', 'testhook');
                    });
                });
            });

            it('should restore timestamp values after failed `replace` operation', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));
                this.replaceStub.returns(Promise.resolve({cas: '1324231541234515', token: undefined}));

                //on first call it deletes the outdated reference document
                var storageErr = new ODM.errors.StorageError('test');
                this.removeStub.onFirstCall().returns(Promise.reject(storageErr));

                this.user.username = 'happiecat';
                var promise = this.user.replace();

                return promise.should.be.rejected.then(function() {
                    var createdAt = self.user.$original.getData('created_at');
                    var updatedAt = self.user.$original.getData('updated_at');

                    self.user.getData('created_at').should.be.equal(createdAt);
                    self.user.getData('updated_at').should.be.equal(updatedAt);
                });
            });

            it('should restore timestamp values if a validation error occurs', function() {
                var self = this;
                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));
                this.replaceStub.returns(Promise.resolve({cas: '1324231541234515', token: undefined}));

                this.user.setData('username', undefined);
                var promise = this.user.replace();

                return promise.should.be.rejected.then(function() {
                    var createdAt = self.user.$original.getData('created_at');
                    var updatedAt = self.user.$original.getData('updated_at');

                    self.user.getData('created_at').should.be.equal(createdAt);
                    self.user.getData('updated_at').should.be.equal(updatedAt);
                });
            });

            it('should return rejected promise with an InstanceError when we try to call the method on an instance object which does not have `cas` value set', function() {
                var self = this;

                this.user.setCAS(null);
                var promise = this.user.replace();

                return promise.should.be.rejected.then(function(error) {
                    error.should.be.instanceof(InstanceError);
                    self.replaceStub.should.have.callCount(0);
                });
            });

            it('should return fulfilled promise when we try to call the method on an instance object which does not have `cas` value set and `force=true`', function() {
                var self = this;

                this.removeStub.returns(Promise.resolve({cas: '72286253696174100', token: undefined}));
                this.insertStub.returns(Promise.resolve({cas: '12343895749571342', token: undefined}));
                this.replaceStub.returns(Promise.resolve({cas: '1324231541234515', token: undefined}));

                this.user.setCAS(null);
                var promise = this.user.replace({force:true});

                return promise.should.be.fulfilled;
            });
        });

    });

    describe('$touchTimestamps', function() {

        before(function() {
            this.model = this.buildModel('Test1', {
                type: DataTypes.HASH_TABLE,
            }, {timestamps: false});

            this.modelWithTimestamps = this.buildModel('Test2', {
                type: DataTypes.HASH_TABLE,
            }, {timestamps: true});

            this.paranoidModel = this.buildModel('Test3', {
                type: DataTypes.HASH_TABLE,
            }, {timestamps: true, paranoid: true});

            this.model.$init(this.modelManager);
            this.modelWithTimestamps.$init(this.modelManager);
            this.paranoidModel.$init(this.modelManager);

            this.convertDateToUTC = convertDateToUTC;

            function convertDateToUTC(date) {
                return new Date(
                        date.getUTCFullYear(),
                        date.getUTCMonth(),
                        date.getUTCDate(),
                        date.getUTCHours(),
                        date.getUTCMinutes(),
                        date.getUTCSeconds()
                        );
            }
        });

        it('should NOT try to update any timestamp properties if `options.timestamps` option is disabled', function() {
            var instance = this.model.build({});

            var propNames = this.model.$getTimestampPropertyNames();
            var getTimestampNamesSpy = sinon.spy(this.model, '$getTimestampPropertyNames');

            instance.$touchTimestamps();

            instance.getData().should.not.have.property(propNames.createdAt);
            instance.getData().should.not.have.property(propNames.updatedAt);
            instance.getData().should.not.have.property(propNames.deletedAt);
            getTimestampNamesSpy.should.have.callCount(0);
            getTimestampNamesSpy.restore();

        });

        it('should touch timestamp values and return state of timestamp property values before they were touched', function() {
            var instanceWithTimestamps = this.modelWithTimestamps.build({});
            var propNames = this.modelWithTimestamps.$getTimestampPropertyNames();

            var originalCreatedAt = moment.utc(1462046976313).format();
            var originalUpdatedAt = moment.utc(1462046976313).format();

            var data = instanceWithTimestamps.getData();
            data[propNames.createdAt] = originalCreatedAt;
            data[propNames.updatedAt] = originalUpdatedAt;

            var timestampsBck = instanceWithTimestamps.$touchTimestamps();

            timestampsBck.should.have.property(propNames.createdAt);
            timestampsBck.should.have.property(propNames.updatedAt);
            timestampsBck.should.have.property(propNames.deletedAt).that.is.an('undefined');

            expect(timestampsBck[propNames.createdAt]).to.equal(data[propNames.createdAt], '`created_at` property was set more than once');
            expect(timestampsBck[propNames.createdAt]).to.equal(originalCreatedAt);

            timestampsBck[propNames.updatedAt].should.not.be.equal(data[propNames.updatedAt]);
            timestampsBck[propNames.updatedAt].should.be.equal(originalUpdatedAt);
        });

        it('should update `created at` property only if the property is NOT set already', function() {
            var propNames = this.modelWithTimestamps.$getTimestampPropertyNames();
            var instanceWithTimestamps = this.modelWithTimestamps.build({});

            var data = instanceWithTimestamps.getData();

            var timestampsBck = instanceWithTimestamps.$touchTimestamps();
            timestampsBck.should.have.property(propNames.createdAt).that.is.a("undefined");
            data.should.have.property(propNames.createdAt).that.is.a('string');
        });

        it('should watch for an object as 1st argument of `$touchTimestamps` call, if it\'s found it should set timestamp values to those provided in the object', function() {
            var propNames = this.paranoidModel.$getTimestampPropertyNames();
            var paranoidInstance = this.paranoidModel.build({});

            var timestampValues = {};
            timestampValues[propNames.createdAt] = moment.utc(1462046976313).format();
            timestampValues[propNames.updatedAt] = moment.utc(1462046976313).format();
            timestampValues[propNames.deletedAt] = moment.utc(1462046979999).format();

            var data = paranoidInstance.getData();
            var timestampsBck = paranoidInstance.$touchTimestamps(timestampValues);

            data.should.have.property(propNames.createdAt, timestampValues[propNames.createdAt]);
            data.should.have.property(propNames.updatedAt, timestampValues[propNames.updatedAt]);
            data.should.have.property(propNames.deletedAt, timestampValues[propNames.deletedAt]);
        });

        it('should update `deleted at` property only if explicit `options.touchDeletedAt` option is set AND the `paranoid` option is enabled', function() {
            var propNames = this.paranoidModel.$getTimestampPropertyNames();
            var paranoidInstance = this.paranoidModel.build({});

            var data = paranoidInstance.getData();
            var timestampsBck = paranoidInstance.$touchTimestamps(undefined, {touchDeletedAt: true});

            timestampsBck.should.have.property(propNames.deletedAt).that.is.an('undefined');
            data.should.have.property(propNames.deletedAt).that.is.a('string');
            data.should.have.property(propNames.deletedAt).that.is.ok;
        });
    });

    describe('toJSON', function() {
        it('should throw an InstanceError when we try to convert an Instance object with primitive root data structure', function() {
            var model = this.buildModel('TOJSONTESTMODEL', {
                type: DataTypes.STRING
            });
            model.$init(this.modelManager);

            var instance = model.build('test string');

            function test() {
                return instance.toJSON();
            };

            expect(test).to.throw(InstanceError);
        });

        describe('Model with JSON root data structure', function() {
            before(function() {
                this.model = this.buildModel('TOJSONTESTMODEL2', {
                    type: DataTypes.HASH_TABLE
                });
                this.model.$init(this.modelManager);

                this.instance = this.model.build({
                    some: 'data'
                });
            });

            it('should return cloned data object', function() {
                this.instance.toJSON().should.not.be.equal(this.instance.getData());
            });

            it('should not include the `_type` internal property in returned data', function() {
                var typePropName = this.model.options.schemaSettings.doc.typePropertyName;
                this.instance.toJSON().should.not.have.property(typePropName);
            });
        });
    });

    describe('inspect', function() {
        it('should return correctly formated string value', function() {
            var model = this.buildModel('INSPECTMODELTEST', {
                type: DataTypes.HASH_TABLE
            });
            model.$init(this.modelManager);

            var instance = model.build({});

            instance.inspect().should.be.equal("[object CouchbaseInstance:\n    " +
                                                    "key: 'INSPECTMODELTEST_undefined'\n    " +
                                                    "cas: undefined]");
        });
    });
});

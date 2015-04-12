var net=require('net');
var aPrompt=require('a_prompt');
var stdout=process.stdout;
const protocolVer=0x01;
const clientVer=0x01;
var nowInput=null;
var linkStatus=0;//0=未連 1=定義名稱 2=已連
var onlineList=[];
var link;

inputNotic();
process.on('beforeExit',function(){
	if(link) link.close();
});

function pullMsg(msg){
	var strLen=Buffer.byteLength(msg);
	var buf=new Buffer(strLen+2);
	buf[0]=0X0D;
	buf.write(msg,1);
	buf[strLen+1]=0x0A;
	stdout.write(buf);
	nowInput && nowInput.update(new Buffer(0));
}

function inputNotic(){
	nowInput=new aPrompt('> ',{'cleanPromptLine':true},function(inputData){
		nowInput=undefined;
		if(inputData.charAt(0)==='/'){
			var args=inputData.split(' ');
			switch(args[0]){
				case '/exit': process.exit(); break;
				case '/nick':
					if(linkStatus===1){
						link.write(encodeBuf({
							'action': 'joinToChatroom',
							'nickname': args[1]
						}));
						link.write(encodeBuf({'action': 'getOnlineList'}));
					}else if(linkStatus===2)
						link.write(encodeBuf({
							'action': 'changeNickname',
							'nickname': args[1]
						}));
					else
						pullMsg('[系統] 未連線');
				break;
				case '/connect':
					if(linkStatus)
						pullMsg('[系統] 目前已有連線');
					else
						connect(args[1]);
				break;
				case '/p':
					var userId=onlineList.indexOf(args[1]);
					if(userId===-1){
						pullMsg('[系統] 密頻對象不存在！');
						break;
					}
					link.write(encodeBuf({
						'action': 'sendPrivateMessage',
						'color': 4,
						'userId': userId,
						'message': args.slice(2).join(' ')
					}));
				break;
			}
		}else if(linkStatus===2){
			link.write(encodeBuf({
				'action': 'sendMessage',
				'color': 4,
				'message': inputData
			}));
		}else{
			switch(linkStatus){
				case 0: pullMsg('[系統] 未連線'); break;
				case 1: pullMsg('[系統] 未設定暱稱'); break;
			}
		}
		//pullMsg(inputData);
		inputNotic();
	});
}

function connect(host){
	link=net.connect(42581,host)
		.on('connect',function(){
			linkStatus=1;
			pullMsg('[系統] 已連上伺服器 '+host+'');
			link.write(encodeBuf({'action': 'getVersions'}));
		})
		.on('data',function(data){
			data=decodeBuf(data);
			switch(data.action){
				case 'getVersions':
					pullMsg('用戶端版本:'+clientVer+' 伺服端版本:'+data.currentServerVersion+' 最新用戶端版本:'+data.latestClientVersion);
				break;
				case 'successToJoin':
					linkStatus=2;
				break;
				case 'someoneJoined':
					onlineList[data.userId]=data.nickname;
					pullMsg('[系統] '+data.nickname+' 加入聊天室');
				break;
				case 'someoneLeaved':
					pullMsg('[系統] '+onlineList[data.userId]+' 離開聊天室');
					onlineList[data.userId]=undefined;
				break;
				case 'sendMessage':
					pullMsg(
						(onlineList[data.userId]===undefined? data.userId:onlineList[data.userId])+'> '+
						data.message
					);
				break;
				case 'sendPrivateMessage':
					pullMsg(
						(onlineList[data.fromUserId]===undefined? data.fromUserId:onlineList[data.fromUserId])+' -> '+
						(onlineList[data.toUserId]===undefined? data.toUserId:onlineList[data.toUserId])+'> '+data.message
					);
				break;
				case 'nicknameChanged':
					pullMsg('[系統] '+onlineList[data.userId]+' 通過身體改造取得了新名稱 '+data.nickname);
					onlineList[data.userId]=data.nickname;
				break;
				case 'onlineList':
					onlineList=[];
					data.list.forEach(function(i){
						onlineList[i.userId]=i.nickname;
					});
				break;
				case 'cannotUnderstand':
					pullMsg('[系統] 未定義指令');
				break;
			}
		})
		.on('close',function(){
			link=null;
			linkStatus=0;
			onlineList=[];
		})
	;
}

function decodeBuf(buf){
	var headerLen=6;
	//if version
	switch(buf[5]){
		case 0x00:
			return {
				'action': 'getVersions',
				'latestClientVersion': buf.slice(headerLen+1,headerLen+1+buf[headerLen]).toString(),
				'currentServerVersion': buf.slice(headerLen+buf[headerLen]+2,headerLen+buf[headerLen]+2+buf[headerLen+buf[headerLen]+1]).toString()
			};
		case 0x10:
			return {'action': 'successToJoin'};
		case 0x11:
			return {'action': 'failedToJoin'};
		case 0x20:
			return {'action': 'passwordRequire'};
		case 0x21:
			return {'action': 'passwordIncorrect'};
		case 0x30:
			return {
				'action': 'someoneJoined',
				'userId': buf[headerLen],
				'nickname': buf.slice(headerLen+2,headerLen+2+buf[headerLen+1]).toString()
			};
		case 0x31:
			return {
				'action': 'someoneLeaved',
				'userId': buf[headerLen]
			};
		case 0x40:
			return {
				'action': 'nicknameChanged',
				'userId': buf[headerLen],
				'nickname': buf.slice(headerLen+2,headerLen+2+buf[headerLen+1]).toString()
			};
		case 0x41:
			return {'action': 'nicknameChangeOkay'};
		case 0x42:
			return {'action': 'nicknameInvalid'};
		case 0x50:
			return {
				'action': 'sendMessage',
				'userId': buf[headerLen],
				'color': buf[headerLen+1],
				'message': buf.slice(headerLen+4,buf.readUInt16LE(headerLen+2))
			};
		case 0x51:
			return {
				'action': 'sendPrivateMessage',
				'fromUserId': buf[headerLen],
				'toUserId': buf[headerLen+1],
				'color': buf[headerLen+2],
				'message': buf.slice(headerLen+5,headerLen+5+buf.readUInt16LE(headerLen+3))
			};
		case 0x52:
			return {'action': 'sendPrivateOkay'};
		case 0x53:
			return {'action': 'sendPrivateFailed'};
		case 0x54:
			return {
				'action': 'serversideSend',
				'message': buf.slice(headerLen+2,buf.readUInt16LE(headerLen))
			}
		case 0x55:
			return {
				'action': 'serversidePrivate',
				'message': buf.slice(headerLen+2,buf.readUInt16LE(headerLen))
			}
		case 0x60:
			var list=[];
			var listLen=0;
			var total=buf[headerLen];
			var procAt=headerLen+1;
			while(listLen<total){
				list.push({
					'userId': buf[procAt++],
					'nickname': buf.slice(procAt+1,procAt+1+buf[procAt]).toString()
				});
				procAt+=buf[procAt];
				listLen++;
			}
			return {
				'action': 'onlineList',
				'list': list
			};
		case 0xff:
			return {'action': 'cannotUnderstand'};
	}
}
function encodeBuf(info){
	var header=new Buffer([0x4D,0x54,0x43,0x52,protocolVer]);
	switch(info.action){
		case 'getVersions':
			return Buffer.concat([header,new Buffer([0x00])]);
		case 'joinToChatroom':
			var nickname=new Buffer(info.nickname);
			return Buffer.concat([header,new Buffer([0x10,nickname.length]),nickname]);
		case 'passwordForJoin':
			var password=new Buffer(info.password);
			return Buffer.concat([header,new Buffer([0x10,nickname.length]),password]);
		case 'changeNickname':
			var nickname=new Buffer(info.nickname);
			return Buffer.concat([header,new Buffer([0x40,nickname.length]),nickname]);
		case 'sendMessage':
			var messageLength=Buffer.byteLength(info.message);
			var message=new Buffer(3+messageLength);
			message.writeUIntLE(messageLength,0,2);
			message.write(info.message,2);
			return Buffer.concat([header,new Buffer([0x50,info.color]),message]);
		case 'sendPrivateMessage':
			var messageLength=Buffer.byteLength(info.message);
			var message=new Buffer(2+messageLength);
			message.writeUIntLE(messageLength,0,2);
			message.write(info.message,2);
			return Buffer.concat([header,new Buffer([0x51,info.userId,info.color]),message]);
		case 'getOnlineList':
			return Buffer.concat([header,new Buffer([0x60])]);
	}
}

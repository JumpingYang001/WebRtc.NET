﻿
var socket = null;
var localstream = null;
var remotestream = null;
var remoteIce = [];
var remoteAnswer = null;
var localIce = [];

var pcOptions = {
    optional: [
        { DtlsSrtpKeyAgreement: true }
    ]
}

var servers = {
    iceServers:
             [
                 { url: 'stun:stun.l.google.com:19302' },
                 { url: 'stun:stun.stunprotocol.org:3478' },
                 { url: 'stun:stun.anyfirewall.com:3478' }
             ]
};

var offerOptions = {
    offerToReceiveAudio: 0,
    offerToReceiveVideo: 1,
    voiceActivityDetection: false,
    iceRestart: true
};

var vgaConstraints = {
    video: true
};

window.onload = function () {
    //getLocalStream();
}

function send(data) {
    try {
        socket.send(data);
    }
    catch (ex) {
        console.log("Message sending failed!");
    }
}

function startStream() {
    console.log("startStream...");

    remotestream = new RTCPeerConnection(servers, pcOptions);

    if (localstream) {
        remotestream.addStream(localstream);
    }

    remotestream.onaddstream = function (e) {
        try {
            console.log("remote media connection success!");

            var vid2 = document.getElementById('vid2');
            vid2.srcObject = e.stream;
            vid2.onloadedmetadata = function (e) {
                vid2.play();
            };

            var t = setInterval(function () {
                if (!remotestream) {
                    clearInterval(t);
                }
                else {
                    Promise.all([
                        remotestream.getStats(null).then(function (o) {
                            return dumpStat(
                                o[Object.keys(o).find(function (key) {
                                    var s = o[key];
                                    return (s.type == "inboundrtp" && !s.isRemote);
                                })
                            ]);
                        })
                    ]).then(function (s) {
                        statsdiv.innerHTML = "<small>" + s + "</small>";
                    });
                }
            }, 100);

        } catch (ex) {
            console.log("Failed to connect to remote media!", ex);
            socket.close();
        }
    };
    remotestream.onicecandidate = function (event) {
        if (event.candidate) {

            var ice = parseIce(event.candidate.candidate);
            if (ice && ice.component_id == 1  // skip RTCP 
                    && ice.localIP.indexOf(":") < 0) { // skip IP6

                console.log('onicecandidate[local]: ' + event.candidate.candidate);
                var obj = JSON.stringify({
                    "command": "onicecandidate",
                    "candidate": event.candidate
                });
                send(obj);
                localIce.push(ice);
            }
            else {
                console.log('onicecandidate[local skip]: ' + event.candidate.candidate);
            }
        }
        else {
            console.log('onicecandidate: complete.')

            if (remoteAnswer) {

                remotestream.setRemoteDescription(
                new RTCSessionDescription({ type: "answer", sdp: remoteAnswer }),
                function () { },
                function (errorInformation) {
                    console.log('setRemoteDescription error: ' + errorInformation);
                    socket.close();
                });

                for (var i = 0, lenr = remoteIce.length; i < lenr; i++) {
                    var c = remoteIce[i];
                    remotestream.addIceCandidate(c);
                }

                // fill empty pairs using last remote ice
                for (var i = 0, lenl = localIce.length; i < lenl; i++) {
                    if (i >= remoteIce.length) {
                        var c = remoteIce[remoteIce.length - 1];

                        var ice = parseIce(c.candidate);
                        ice.foundation += i;
                        c.candidate = stringifyIce(ice);

                        remotestream.addIceCandidate(c);
                    }
                }
            }
        }
    };

    remotestream.createOffer(function (desc) {
        console.log('createOffer: ' + desc.sdp);

        remotestream.setLocalDescription(desc, function () {
            var obj = JSON.stringify({
                "command": "offer",
                "desc": desc
            });
            send(obj);
        },
        function (errorInformation) {
            console.log('setLocalDescription error: ' + errorInformation);

            socket.close();
        });
    },
    function (error) {
        console.log(error);
        socket.close();
    },
    offerOptions);
}

function connect() {

    document.getElementById('btnconnect').disabled = true;

    socket = new WebSocket("ws://" + server.value);
    setSocketEvents(socket);

    function setSocketEvents(Socket) {
        Socket.onopen = function () {
            console.log("Socket connected!");

            startStream();
        };

        Socket.onclose = function () {
            console.log("Socket connection has been disconnected!");

            if (remotestream) {
                remotestream.close();
                remotestream = null;
            }
            remoteAnswer = null;
            remoteIce = [];
            localIce = [];

            document.getElementById('btnconnect').disabled = false;
        }

        Socket.onmessage = function (Message) {
            var obj = JSON.parse(Message.data);
            var command = obj.command;
            switch (command) {
                case "OnSuccessAnswer": {
                    if (remotestream) {
                        console.log("OnSuccessAnswer[remote]: " + obj.sdp);

                        remoteAnswer = obj.sdp;
                    }
                }
                    break;

                case "OnIceCandidate": {
                    if (remotestream) {
                        console.log("OnIceCandidate[remote]: " + obj.sdp);

                        remoteIce.push(new RTCIceCandidate({
                            sdpMLineIndex: obj.sdp_mline_index,
                            candidate: obj.sdp
                        }));
                    }
                }
                    break;

                default: {
                    console.log(Message.data);
                }
            }
        };
    }
}

function dumpStat(o) {
    if (o != undefined) {
        var s = "Timestamp: " + new Date(o.timestamp).toTimeString() + " Type: " + o.type + "<br>";
        if (o.ssrc) s += "SSRC: " + o.ssrc + " ";
        if (o.packetsReceived !== undefined) {
            s += "Recvd: " + o.packetsReceived + " packets (" +
                 (o.bytesReceived / 1000000).toFixed(2) + " MB)" + " Lost: " + o.packetsLost;
        } else if (o.packetsSent !== undefined) {
            s += "Sent: " + o.packetsSent + " packets (" + (o.bytesSent / 1000000).toFixed(2) + " MB)";
        }
        if (o.bitrateMean !== undefined) {
            s += "<br>Avg. bitrate: " + (o.bitrateMean / 1000000).toFixed(2) + " Mbps (" +
                 (o.bitrateStdDev / 1000000).toFixed(2) + " StdDev)";
            if (o.discardedPackets !== undefined) {
                s += " Discarded packts: " + o.discardedPackets;
            }
        }
        if (o.framerateMean !== undefined) {
            s += "<br>Avg. framerate: " + (o.framerateMean).toFixed(2) + " fps (" +
                 o.framerateStdDev.toFixed(2) + " StdDev)";
            if (o.droppedFrames !== undefined) s += " Dropped frames: " + o.droppedFrames;
            if (o.jitter !== undefined) s += " Jitter: " + o.jitter;
        }
        if (o.googFrameRateReceived !== undefined) {
            s += "<br>googFrameRateReceived: " + o.googFrameRateReceived + " fps";
            s += " googJitterBufferMs: " + o.googJitterBufferMs;
            s += "<br>googCurrentDelayMs: " + o.googCurrentDelayMs;
            s += " googDecodeMs: " + o.googDecodeMs;
        }
    }
    return s;
}

function parseIce(candidateString) {
    // token                  =  1*(alphanum / "-" / "." / "!" / "%" / "*"
    //                              / "_" / "+" / "`" / "'" / "~" )
    var token_re = '[0-9a-zA-Z\\-\\.!\\%\\*_\\+\\`\\\'\\~]+';

    // ice-char               = ALPHA / DIGIT / "+" / "/"
    var ice_char_re = '[a-zA-Z0-9\\+\\/]+';

    // foundation             = 1*32ice-char
    var foundation_re = ice_char_re;

    // component-id           = 1*5DIGIT
    var component_id_re = '[0-9]{1,5}';

    // transport             = "UDP" / transport-extension
    // transport-extension   = token      ; from RFC 3261
    var transport_re = token_re;

    // priority              = 1*10DIGIT
    var priority_re = '[0-9]{1,10}';

    // connection-address SP      ; from RFC 4566
    var connection_address_v4_re = '[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}';
    var connection_address_v6_re = '\\:?(?:[0-9a-fA-F]{0,4}\\:?)+'; // fde8:cd2d:634c:6b00:6deb:9894:734:f75f

    var connection_address_re = '(?:' + connection_address_v4_re + ')|(?:' + connection_address_v6_re + ')';

    // port                      ; port from RFC 4566
    var port_re = '[0-9]{1,5}';

    //  cand-type             = "typ" SP candidate-types
    //  candidate-types       = "host" / "srflx" / "prflx" / "relay" / token
    var cand_type_re = token_re;

    var ICE_RE = '(?:a=)?candidate:(' + foundation_re + ')' + // candidate:599991555 // 'a=' not passed for Firefox (and now for Chrome too)
      '\\s' + '(' + component_id_re + ')' +                 // 2
      '\\s' + '(' + transport_re + ')' +                 // udp
      '\\s' + '(' + priority_re + ')' +                 // 2122260222
      '\\s' + '(' + connection_address_re + ')' +                 // 192.168.1.32 || fde8:cd2d:634c:6b00:6deb:9894:734:f75f
      '\\s' + '(' + port_re + ')' +                 // 49827
      '\\s' + 'typ' +                       // typ
      '\\s' + '(' + cand_type_re + ')' +                 // host
      '(?:' +
      '\\s' + 'raddr' +
      '\\s' + '(' + connection_address_re + ')' +
      '\\s' + 'rport' +
      '\\s' + '(' + port_re + ')' +
      ')?' +
      '(?:' +
      '\\s' + 'generation' +                       // generation
      '\\s' + '(' + '\\d+' + ')' +                 // 0
      ')?' +
      '(?:' +
      '\\s' + 'ufrag' +                       // ufrag
      '\\s' + '(' + ice_char_re + ')' +      // WreAYwhmkiw6SPvs
      ')?';

    var pattern = new RegExp(ICE_RE);
    var parsed = candidateString.match(pattern);

    //console.log('parseIceCandidate(): candidateString:', candidateString);
    //console.log('parseIceCandidate(): pattern:', pattern);
    //console.log('parseIceCandidate(): parsed:', parsed);

    // Check if the string was successfully parsed
    if (!parsed) {
        console.warn('parseIceCandidate(): parsed is empty: \'' + parsed + '\'');
        return null;
    }

    var propNames = [
      'foundation',
      'component_id',
      'transport',
      'priority',
      'localIP',
      'localPort',
      'type',
      'remoteIP',
      'remotePort',
      'generation',
      'ufrag'
    ];

    var candObj = {};
    for (var i = 0; i < propNames.length; i++) {
        candObj[propNames[i]] = parsed[i + 1];
    }
    return candObj;
}

function stringifyIce(iceCandObj) {
    var s = 'candidate:' + iceCandObj.foundation + '' +
          ' ' + iceCandObj.component_id + '' +
          ' ' + iceCandObj.transport + '' +
          ' ' + iceCandObj.priority + '' +
          ' ' + iceCandObj.localIP + '' +
          ' ' + iceCandObj.localPort + '' +
          ' typ ' + iceCandObj.type + '' +
          (iceCandObj.remoteIP ? ' raddr ' + iceCandObj.remoteIP + '' : '') +
          (iceCandObj.remotePort ? ' rport ' + iceCandObj.remotePort + '' : '') +
          (iceCandObj.generation ? ' generation ' + iceCandObj.generation + '' : '') +
          (iceCandObj.ufrag ? ' ufrag ' + iceCandObj.ufrag + '' : '');
    return s;
}

//---------------------------------------

function getLocalStream() {

    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        console.log("enumerateDevices() not supported.");
        return;
    }

    // List cameras and microphones.
    navigator.mediaDevices.enumerateDevices().then(function (devices) {
        devices.forEach(function (device) {
            console.log(device.kind + ": " + device.label +
                        " id = " + device.deviceId);
        });
    }).catch(function (err) {
        console.log(err.name + ": " + error.message);
    });

    console.log('Requesting local stream');

    navigator.mediaDevices.getUserMedia(vgaConstraints).then(function (stream) {
        console.log('Received local stream');

        var vid1 = document.getElementById('vid1');
        if (vid1) {
            vid1.srcObject = stream;
            vid1.onloadedmetadata = function (e) {
                vid1.play();
            };
        }

        localstream = stream;
    })
    .catch(function (err) {
        console.log(err.name + ": " + err.message);
        alert(err.name + ": " + err.message);
    });
}

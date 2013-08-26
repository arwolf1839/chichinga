var fs = require("fs");
var http = require("http");
var https = require("https");
var net = require("net");
var url = require("url");
var os = require("os");

var notifier = new Notifier();

readJSON("chichinga-video.json", function(data) {
  if (data != null) {
    // TODO: check thy connectivity
    processChichinga(data);
  }
});

function initServer() {
  process.on('exit', function() {
    setTimeout(function() {
      console.log('This will not run');
    }, 0);
    console.log("come on");
    //notifier.notify("Chichinga is shutting down", true);
  });
}

function processChichinga(pConfig) {
  console.log("processing with config: \n" + JSON.stringify(pConfig));

  var reporters = createReporters(pConfig.reports);
  notifier.setReporters(reporters);

  initServer();

  var checkers = createCheckers(pConfig.checks);
  checkers.forEach(function(checker) {
    checker.check();
  });
}

function createMsg(pPolicy, pCheck, pResult) {
  switch (pPolicy) {
    case "changeOnly" :
      if (pResult.change) {
        return "'" + pCheck.name + "' went #" + pResult.state + "\n" + JSON.stringify(pCheck);
      }
      break;
    case "downOnly" :
      if (pResult.state == "DOWN") {
        return createStateMsg(pCheck, pResult);
      }
      break;
    case "all" :
      return createStateMsg(pCheck, pResult);
  }
  return null;
}

function createStateMsg(pCheck, pResult) {
  var msg = "'" + pCheck.name + "' is #" + pResult.state + "";
  if (pResult.state == "DOWN") {
    msg += "\n" + JSON.stringify(pCheck);
  }
  return msg;
}

/*** Notifier ***/

function Notifier() {

  var reporters;
  this.setReporters = function(pReporters) {
    reporters =  pReporters;
  }

  this.notify = function(pCheck, pResult) {
    reporters.forEach(function (reporter) {
      var pMsg = createMsg(reporter.policy, pCheck, pResult);
      if (pMsg) {
        var isError = pResult.state == "DOWN" ? true : false;
        reporter.report(pMsg, isError);
      }
    });
  }

  this.notifyMsg = function(pMsg, isError) {
    reporters.forEach(function (reporter) {
        reporter.report(pMsg, isError);
    });
  }
}

/*** Checker ***/

function createCheckers(pChecks) {
  var checkers = [];
  pChecks.forEach(function(check) {
    if (check.type == 'http') {
      checkers.push(new HttpChecker(check));
    }
    else if (check.type == 'net') {
      checkers.push(new NetChecker(check));
    }
  });
  return checkers;
}

function HttpChecker(pCheckConf) {
  var checkConf = pCheckConf;
  var loc = url.parse(checkConf.url);
  loc.headers = {
    "Accept" : "*/*"
  }

  this.check = function() {
    http.get(loc, function(res) {
      if (res.statusCode == 200) {
        notifyStatus(checkConf, "UP");
      }
      else {
        notifyStatus(checkConf, "DOWN");
      }
      res.on('data', function(data) {});
    }).on("error", function(e) {
          console.log("ERROR:" + e.message);
          notifyStatus(checkConf, "DOWN");
        });
  }
}

function notifyStatus(pCheckConf, pState) {
  var file = pCheckConf.name.replace(new RegExp(' ', 'g'), '-')+".stat.json";
  readJSON(file, function(data) {
    var change = false;
    if (data != null) {
      var change = (data.state != pState) ? true: false;
    }
    saveJSON(file, { state: pState});
    notifier.notify(pCheckConf, {
      state : pState,
      change: change
    });
  });
}

function NetChecker(pCheckConf) {
  var checkConf = pCheckConf;

  this.check = function() {
    var client = net.createConnection(pCheckConf.port, pCheckConf.host);
    client.on('connect', function () {
      notifyStatus(pCheckConf, "UP");
      client.destroy();
    });
    client.on('error', function (e) {
      notifyStatus(pCheckConf, "DOWN");
      console.log('ERROR: ' + e.message);
    });
    client.setTimeout(5000, function () {
      notifyStatus(pCheckConf, "DOWN");
      client.destroy();
    });
  };
}

/*** Reporter ***/

function createReporters(pReports) {
  var reporters = [];
  pReports.forEach(function(report) {
    if (report.type == 'log') {
      reporters.push(new LogReporter(report));
    }
    else if (report.type == 'console') {
      reporters.push(new ConsoleReporter(report));
    }
    else if (report.type == 'http') {
      reporters.push(new HttpReporter(report));
    }
    else if (report.type == 'hipchat') {
      reporters.push(new HipchatReporter(report));
    }
  });
  return reporters;
}

function LogReporter(pReportConf) {
  var name = "log reporter";
  var pReportConf = pReportConf;

  this.policy = pReportConf.policy;
  this.report = function(pMsg) {
    var logMsg = pMsg + "\n";
    fs.appendFile(pReportConf.file, time() + logMsg, function(err) {
      if (err) {
        console.log("Write failed, file :" + pReportConf.file +", error: " + err);
      }
    });
  }
}

function HttpReporter(pReportConf) {
  var name = "http reporter";
  var reportConf = pReportConf;

  var loc = url.parse(reportConf.uriTemplate);
  var httpClient = (loc.protocol == 'https') ? https : http;

  this.policy = reportConf.policy;
  this.report = function(pMsg, isError) {
    var options = {
      hostname : loc.hostname,
      port : loc.port,
      path : loc.path.replace("{msg}", encodeURIComponent(pMsg)) + "&color=" + (isError ? "red" : "green"),
      method: reportConf.method
    };

    //console.log("SENDING:" + JSON.stringify(options));
    var req = httpClient.request(options, function(res) {
      console.log(loc.hostname + " reponse: " + res.statusCode);
      res.setEncoding('utf8');
      res.on('data', function (chunk) { });
    });
    req.on('error', function(e) {
      console.log("error requesting " + loc.hostname + ": " + e.message);
    });

    var logMsg = pMsg + "\n";
    req.write(logMsg);
    req.end();
  }
}

function HipchatReporter(pReportConf) {
  var name = "http reporter";
  var reportConf = pReportConf;

  var loc = url.parse(reportConf.uriTemplate);
  var httpClient = (loc.protocol == 'https') ? https : http;

  this.policy = reportConf.policy;
  this.report = function(pMsg, isError) {
    var options = {
      hostname : loc.hostname,
      port : loc.port,
      path : loc.path.replace("{msg}", encodeURIComponent(pMsg)) + "&color=" + (isError ? "red" : "green"),
      method: reportConf.method
    };

    //console.log("SENDING:" + JSON.stringify(options));
    var req = httpClient.request(options, function(res) {
      console.log(loc.hostname + " reponse: " + res.statusCode);
      res.setEncoding('utf8');
      res.on('data', function (chunk) { });
    });
    req.on('error', function(e) {
      console.log("error requesting " + loc.hostname + ": " + e.message);
    });

    var logMsg = pMsg + "\n";
    req.write(logMsg);
    req.end();
  }
}


function ConsoleReporter(pReportConf) {
  var name = "console reporter";
  this.policy="all";
  this.report = function(pMsg) {
    console.log(time() + pMsg);
  }
}

function saveJSON(pJsonFile, pData) {
  fs.writeFile(pJsonFile, JSON.stringify(pData), function(err) {
    if (err) console.log("Failed saving " + pJsonFile);
  });
}

function readJSON(pJsonFile, fpCallback) {
  fs.readFile(pJsonFile, function(err, data) {
    if (err) {
      console.log("Read failed, config file : " + pJsonFile + ", error" + err.message);
      fpCallback(null);
    }
    else {
      var dataStr = data.toString();
      try {
        var data = JSON.parse(dataStr);
      } catch (err) {
        console.log("Invalid JSON format in config file: '" + pJsonFile + "' Error: " + err.message);
      }
      if (data) fpCallback(data);
    }
  });
}

function time() {
  var d = new Date();
  return "[" + d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate()  + ', ' + d.getHours()  + ':' + d.getMinutes() + ':' + d.getSeconds() + "] ";
}

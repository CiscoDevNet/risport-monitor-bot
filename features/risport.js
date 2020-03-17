const base64 = require( 'base-64' );
const xml2js = require( 'xml2js' );

module.exports = function ( controller ) {

    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    var monitorInterval = 10; // seconds

    var monitoredDevices = null;

    // If you want to start with a pre-existing list of devices to monitor...
    var monitoredDevices = [ 
        'IPCMRAEU5UCM5X7',
        'CSFdstaudt'
    ];

    var monitorTimer = null;

    var monitorBotReference = null;

    var lastStateInfo = null;

    const parser = new xml2js.Parser();

    controller.hears( 'risport add', 'message,direct_message', async ( bot, message ) => {

        let command = message.text.split( ' ' );
        monitoredDevices.push( command[ 2 ] );
        await bot.reply( message, `Added device to monitoring list--> \`${ command[ 2 ] }\`` );
        if ( !monitorTimer ) {
            await bot.reply( message, 'Monitoring is currently disabled.  Use `risport start` to enable.' );
        }
    });

    controller.hears( 'risport remove', 'message,direct_message', async ( bot, message ) => {

        let command = message.text.split( ' ' );
        monitoredDevices = monitoredDevices.filter( ( i ) => { return i != command[ 2 ] } );
        await bot.reply( message, `Removed device--> ${ command[ 2 ] }` );
        if ( monitoredDevices.legnth == 0 ) {
            clearInterval( monitorTimer );
            await bot.reply( message, 'All devices removed - monitoring disabled' );
        }
    });

    controller.hears( '^risport start', 'message,direct_message', async ( bot, message ) => {

        if ( monitoredDevices.length == 0 ) {
            await bot.reply( 'No devices to monitor.  Use `risport add {devicename}` to add a device' );
            return;
        }

        monitorBotReference = message.reference;

        if ( monitorTimer ) {
            await bot.reply( 'Monitoring has already been started' );
            return;
        }

        monitorTimer = setInterval( risportPoll, monitorInterval * 1000 );

        await bot.reply( message, `Monitoring enabled - devices will be polled every ${ monitorInterval } seconds` );
    });    
    
    controller.hears( '^risport stop', 'message,direct_message', async ( bot, message ) => {

        if ( monitorTimer ) {
            clearInterval( monitorTimer );
        }
        await bot.reply( message, 'Device monitoring stopped' );
    });

    async function risportPoll() {

        let stateInfo; 

        if ( lastStateInfo ) {
            stateInfo = lastStateInfo.replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        }
        else {
            stateInfo = '';
        }

        let xmlReq = `<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" 
            xmlns:soap=\"http://schemas.cisco.com/ast/soap\">
            <soapenv:Header/>
            <soapenv:Body>
                <soap:selectCmDeviceExt>
                    <soap:StateInfo>${ stateInfo }</soap:StateInfo>
                    <soap:CmSelectionCriteria>
                        <soap:MaxReturnedDevices>${ monitoredDevices.length }</soap:MaxReturnedDevices>
                        <soap:DeviceClass>Any</soap:DeviceClass>
                        <soap:Model>255</soap:Model>
                        <soap:Status>Any</soap:Status>
                        <soap:NodeName/>
                        <soap:SelectBy>Name</soap:SelectBy>
                        <soap:SelectItems>\n`;

        for ( device of monitoredDevices ) {
            xmlReq += `                            <soap:item><soap:Item>${ device }</soap:Item></soap:item>\n`
        }

        xmlReq += `                        </soap:SelectItems>
                        <soap:Protocol>Any</soap:Protocol>
                        <soap:DownloadStatus>Any</soap:DownloadStatus>        
                    </soap:CmSelectionCriteria>
                </soap:selectCmDeviceExt>
            </soapenv:Body>
        </soapenv:Envelope>`;

        let thisSnapshot = null;

        await fetch( `https://${ process.env.CUCM_ADDRESS }:8443/realtimeservice2/services/RISService70`,
            {
                method: "POST",
                body: xmlReq,
                headers: { 
                    "Content-Type": "text/xml", 
                    "SOAPAction": "\"selectCmDeviceExt\"",
                    Authorization: 'Basic ' + base64.encode( process.env.RIS_USER + ':' + process.env.RIS_PASSWORD )
                }
        } )
        .then( async res => await res.text() )
        .then( async body => await parser.parseString( body, async ( err, result ) => {
                thisSnapshot = result;
            } )
        )

        lastStateInfo = thisSnapshot['soapenv:Envelope']
            ['soapenv:Body'][0]
                ['ns1:selectCmDeviceResponse'][0]
                    ['ns1:selectCmDeviceReturn'][0]
                        ['ns1:StateInfo'][0];

        let nodeList = thisSnapshot['soapenv:Envelope']
            ['soapenv:Body'][0]
                ['ns1:selectCmDeviceResponse'][0]
                    ['ns1:selectCmDeviceReturn'][0]
                        ['ns1:SelectCmDeviceResult'][0]
                            ['ns1:CmNodes'][0]
                                ['ns1:item'];

        let report = '';

        for ( node of nodeList ) {

            deviceList = node['ns1:CmDevices'][0]['ns1:item'];

            if ( !deviceList ) continue;

            for ( device of deviceList ) {

                let padName = ( device['ns1:Name'][0] + '               ' ).slice( 0, 15 );
                report += '`' + padName + ': ' + device['ns1:Status'][0] + '`  \n';
            }
        }

        if ( report == '' ) return;

        bot = await controller.spawn( );
        await bot.changeContext( monitorBotReference );
        await bot.say( { channelData: { markdown: report } } );
    }

    controller.commandHelp.push( { command: 'risport', text: 'Monitor a list of phone devices for registration changes; includes `risport add {devicename}`, `risport remove {deviceName}`, `risport start`, `risport stop`' } );

}
import {Service} from "typedi";
import {Connection, In} from "typeorm";
import {InjectConnection} from "typeorm-typedi-extensions";
import {MetaData} from "../../entity/MetaData";
import RoRest from "../services/RoRest";
import {HTMLElement, parse} from "node-html-parser";
import {TorrentFile} from "../../entity/TorrentFile";
import {IMediaEntry} from "../../common/models/IMediaEntry";
import * as ptn from "../../common/lib/parse-torrent-name";

type TorrentLinks = Array<{title: string, magnet: string}>;

@Service()
export class TorrentsRepository {

    @InjectConnection("reading")
    private connection: Connection;

    public async getAllTorrents() {
        const metaRepo = this.connection.manager.getRepository(MetaData);
        return metaRepo.find();
    }

    public async reprocessTorrents() {
        const links = await this.processTorrentzProvider();
        // console.log(links);
        // const torrentsFiles: TorrentFile[] = [];
        for (const link of links) {
            const mEntry: IMediaEntry = ptn(link.title);
            if (Object.keys(mEntry).length >= 4) {
                console.log(mEntry);
            }
        }
    }

    private async processTorrentzProvider() {
        let links: TorrentLinks = [];
        links = links.concat(await this.torrentzProviderGetPage(0));
        // links = links.concat(await this.torrentzProviderGetPage(1));
        // links = links.concat(await this.torrentzProviderGetPage(2));
        // links = links.concat(await this.torrentzProviderGetPage(3));
        // links = links.concat(await this.torrentzProviderGetPage(4));
        console.log(links.length);
        return links;
    }

    private async torrentzProviderGetPage(pg: number): Promise<TorrentLinks> {
        return new Promise((resolve) => {
            const links: TorrentLinks = [];
            RoRest.send("get", `https://torrentz2.eu/verifiedN?f=movies tv added:7d&p=${pg}&safe=1`)
                .then(html => {
                    const root = parse(html) as HTMLElement;
                    const selection = root.querySelectorAll("dl dt a");
                    if (selection && selection.length > 0) {
                        selection.forEach((o: HTMLElement) => {
                            if (o.innerHTML && o.attributes.hasOwnProperty("href")) {
                                const magnet = o.attributes.href.slice(1);
                                links.push({title: o.innerHTML, magnet});
                            }
                        });
                    }
                    resolve(links);
                }).catch(() => {
                    console.warn("could not finish torrents page scrape");
                    resolve(links);
            });
        });
    }
}

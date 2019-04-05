import {Service} from "typedi";
import {Connection, ObjectType} from "typeorm";
import {InjectConnection} from "typeorm-typedi-extensions";
import {MetaData} from "../../entity/MetaData";

@Service()
export class MediaRepository {

    @InjectConnection("reading")
    private connection: Connection;

    public getAllMedia() {
        const metaRepo = this.connection.manager.getRepository(MetaData);
        return metaRepo.find();
    }

    public getMovies() {
        const metaRepo = this.connection.manager.getRepository(MetaData);
        return metaRepo.find({type: "movie"});
    }

    public getSeries() {
        const metaRepo = this.connection.manager.getRepository(MetaData);
        return metaRepo.find({type: "series"});
    }

    public query(payload: {entity: string, query: any}): Promise<any> {
        const repository = payload.entity;
        const q = payload.query;
        console.log("query", repository);
        console.log("query", q);
        return new Promise((resolve, reject) => {
            this.connection.manager.getRepository(repository).find(q)
                .then(resolve)
                .catch(e => {
                    console.error("could not perform query", e);
                    reject();
                });
        });
    }
}
